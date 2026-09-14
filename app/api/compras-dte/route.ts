import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(60)

// ─── Parser DTE de COMPRA (DISABI como receptor) ───────────────────────────────
// Estructura idéntica al DTE de venta del MH, pero aquí el "emisor" del JSON
// es el PROVEEDOR real (quien vendió) y el "receptor" es DISABI.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Tipos de DTE que NO son facturas de compra y deben rechazarse explícitamente:
// 05 = Nota de Crédito, 06 = Nota de Débito, 07 = Comprobante de Retención
// (el 07 en particular documenta una RETENCIÓN sobre una VENTA de DISABI a un tercero —
//  no tiene estructura de items/precio de compra y su total_pagar no existe)
const TIPOS_NO_COMPRA: Record<string, string> = {
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '07': 'Comprobante de Retención (documenta una venta de DISABI, no una compra)',
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDteCompra(json: any, nombreArchivo: string) {
  const id  = json?.identificacion ?? {}
  const em  = json?.emisor ?? {}       // el proveedor real
  const res = json?.resumen ?? {}
  const cuerpo = json?.cuerpoDocumento ?? []

  const numeroControl    = id.numeroControl   ?? id.numControl   ?? ''
  const codigoGeneracion = id.codigoGeneracion ?? id.uuid        ?? ''
  const tipoDte          = id.tipoDte         ?? id.tipo         ?? '01'
  const fechaEmision     = id.fecEmi          ?? id.fechaEmision ?? ''

  if (TIPOS_NO_COMPRA[tipoDte])
    throw new Error(`Documento tipo ${tipoDte} (${TIPOS_NO_COMPRA[tipoDte]}) — no es una factura de compra, se omite`)

  const proveedorNombre = em.nombre ?? em.nombreComercial ?? ''
  const proveedorNit    = em.nit ?? null

  const totalGravado = round2(Number(res.totalGravada ?? res.totalGravado ?? 0))
  const totalPagar   = round2(Number(res.totalPagar   ?? res.montoTotalOperacion ?? 0))

  if (!numeroControl)    throw new Error(`El archivo "${nombreArchivo}" no tiene numeroControl`)
  if (!codigoGeneracion) throw new Error(`El archivo "${nombreArchivo}" no tiene codigoGeneracion`)
  if (!fechaEmision)     throw new Error(`El archivo "${nombreArchivo}" no tiene fecha de emisión`)
  if (!proveedorNombre)  throw new Error(`El archivo "${nombreArchivo}" no tiene nombre del proveedor (emisor)`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = cuerpo.map((linea: any) => {
    const cantidad = Number(linea.cantidad ?? 1)
    const precioUnitario = round2(Number(linea.precioUni ?? 0))
    const subtotal = round2(Number(linea.ventaGravada ?? (precioUnitario * cantidad)))
    return {
      codigo:      linea.codigo ?? null,
      descripcion: (linea.descripcion || 'Sin descripción').trim(),
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
    }
  })

  return {
    numero_control: numeroControl,
    codigo_generacion: codigoGeneracion,
    tipo_dte: tipoDte,
    fecha_emision: fechaEmision,
    proveedor_nombre: proveedorNombre,
    proveedor_nit: proveedorNit,
    total_gravado: totalGravado,
    total_pagar: totalPagar,
    items,
    archivo_origen: nombreArchivo,
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  const sb = await createClient()
  const body = await req.json()
  const { action } = body

  try {
    // ── PREVISUALIZAR — parsea sin guardar nada, agrupa por proveedor ────────
    if (action === 'previsualizar_compras_dte') {
      const { documentos } = body as { documentos: { nombre: string; json: unknown }[] }
      if (!documentos?.length)
        return NextResponse.json({ error: 'Sin documentos para previsualizar' }, { status: 400 })

      const { data: productos } = await sb.from('disabi_productos')
        .select('id, codigo, nombre').eq('activo', true)

      // Proveedores con regla conocida — ajustable según lo que vayas confirmando
      const REGLAS_PROVEEDOR: Record<string, 'compra_local' | 'operativo'> = {
        'BALLOONIA': 'operativo',
        'ALESSANDRA NICOLE ROMERO GONZALEZ': 'operativo', // razón social de Balloonia
      }

      const documentosParsed: {
        nombre: string; ok: boolean; error?: string
        numero_control?: string; codigo_generacion?: string
        proveedor?: string; fecha?: string; total?: number
        items?: { descripcion: string; cantidad: number; match: boolean }[]
        ya_existe?: boolean
        tipo_egreso_sugerido?: 'compra_local' | 'operativo'
      }[] = []

      const vistosEnLote = new Set<string>()

      for (const doc of documentos) {
        try {
          const parsed = parseDteCompra(doc.json, doc.nombre)

          // Duplicado dentro del mismo lote (ej: el mismo archivo subido dos veces)
          if (vistosEnLote.has(parsed.codigo_generacion)) {
            documentosParsed.push({
              nombre: doc.nombre, ok: false,
              error: `Duplicado dentro de este mismo lote (mismo documento: ${parsed.numero_control})`,
            })
            continue
          }
          vistosEnLote.add(parsed.codigo_generacion)

          const { data: existente } = await sb.from('disabi_compras')
            .select('id').eq('codigo_generacion_dte', parsed.codigo_generacion).maybeSingle()

          const itemsConMatch: { descripcion: string; cantidad: number; match: boolean }[] = parsed.items.map((item: { codigo: string | null; descripcion: string; cantidad: number }) => {
            const match = (productos ?? []).some(p =>
              (item.codigo && p.codigo === item.codigo) ||
              p.nombre.toLowerCase() === item.descripcion.toLowerCase() ||
              p.nombre.toLowerCase().includes(item.descripcion.toLowerCase()) ||
              item.descripcion.toLowerCase().includes(p.nombre.toLowerCase())
            )
            return { descripcion: item.descripcion, cantidad: item.cantidad, match }
          })

          const proveedorKey = parsed.proveedor_nombre.toUpperCase().trim()
          const tieneMatch = itemsConMatch.some(i => i.match)
          const sugerido = REGLAS_PROVEEDOR[proveedorKey]
            ?? (tieneMatch ? 'compra_local' : 'operativo')

          documentosParsed.push({
            nombre: doc.nombre, ok: true,
            numero_control: parsed.numero_control,
            codigo_generacion: parsed.codigo_generacion,
            proveedor: parsed.proveedor_nombre,
            fecha: parsed.fecha_emision,
            total: parsed.total_pagar,
            items: itemsConMatch,
            ya_existe: !!existente,
            tipo_egreso_sugerido: sugerido,
          })
        } catch (e: unknown) {
          documentosParsed.push({ nombre: doc.nombre, ok: false, error: e instanceof Error ? e.message : 'Error al leer el JSON' })
        }
      }

      // Agrupar por proveedor para revisión rápida
      const porProveedor: Record<string, { total: number; documentos: number; tipo_egreso_sugerido: string }> = {}
      for (const d of documentosParsed) {
        if (!d.ok || !d.proveedor) continue
        if (!porProveedor[d.proveedor]) porProveedor[d.proveedor] = { total: 0, documentos: 0, tipo_egreso_sugerido: d.tipo_egreso_sugerido ?? 'operativo' }
        porProveedor[d.proveedor].total += d.total ?? 0
        porProveedor[d.proveedor].documentos += 1
      }

      return NextResponse.json({ ok: true, documentos: documentosParsed, porProveedor })
    }

    // ── Importar uno o varios JSON de compras (DTE recibidos de proveedores) ──
    if (action === 'importar_compras_dte') {
      const { documentos, tipoEgresoPorProveedor } = body as {
        documentos: { nombre: string; json: unknown }[]
        tipoEgresoPorProveedor?: Record<string, 'compra_local' | 'operativo'>
      }
      if (!documentos?.length)
        return NextResponse.json({ error: 'Sin documentos para importar' }, { status: 400 })

      // Catálogo de productos activos para hacer match automático
      const { data: productos } = await sb.from('disabi_productos')
        .select('id, codigo, nombre, costo_unitario').eq('activo', true)

      const resultados: { nombre: string; ok: boolean; numero_control?: string; error?: string; items_creados?: number; items_sin_match?: number; tipo_egreso?: string }[] = []
      const vistosEnLote = new Set<string>()

      for (const doc of documentos) {
        try {
          const parsed = parseDteCompra(doc.json, doc.nombre)

          // Duplicado dentro del mismo lote (ej: mismo archivo subido dos veces)
          if (vistosEnLote.has(parsed.codigo_generacion)) {
            resultados.push({ nombre: doc.nombre, ok: false, numero_control: parsed.numero_control, error: 'Duplicado dentro de este mismo lote' })
            continue
          }
          vistosEnLote.add(parsed.codigo_generacion)

          // Evitar duplicados: si ya existe una compra con este codigo_generacion, saltar
          const { data: existente } = await sb.from('disabi_compras')
            .select('id').eq('codigo_generacion_dte', parsed.codigo_generacion).maybeSingle()

          if (existente) {
            resultados.push({ nombre: doc.nombre, ok: false, numero_control: parsed.numero_control, error: 'Ya importado anteriormente (duplicado)' })
            continue
          }

          // Match de items contra el catálogo por código o nombre
          let itemsSinMatch = 0
          type ItemConMatch = { producto_id: string | null; descripcion: string; cantidad: number; costo_unitario: number; subtotal: number }
          const itemsConMatch: ItemConMatch[] = parsed.items.map((item: { codigo: string | null; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }) => {
            const prod = (productos ?? []).find(p =>
              (item.codigo && p.codigo === item.codigo) ||
              p.nombre.toLowerCase() === item.descripcion.toLowerCase() ||
              p.nombre.toLowerCase().includes(item.descripcion.toLowerCase()) ||
              item.descripcion.toLowerCase().includes(p.nombre.toLowerCase())
            )
            if (!prod) itemsSinMatch++
            return {
              producto_id: prod?.id ?? null,
              descripcion: item.descripcion,
              cantidad: item.cantidad,
              costo_unitario: item.precio_unitario,
              subtotal: item.subtotal,
            }
          })

          // Crear la compra
          const { count } = await sb.from('disabi_compras').select('*', { count: 'exact', head: true })
          const numero = 'IMP-DTE-' + String((count ?? 0) + 1).padStart(4, '0')

          const { data: compra, error: compraErr } = await sb.from('disabi_compras')
            .insert([{
              numero, proveedor: parsed.proveedor_nombre, fecha: parsed.fecha_emision,
              estado: 'Recibido', tipo: 'Importacion', moneda: 'USD',
              monto_total: parsed.total_pagar, impuestos: 0, monto_final: parsed.total_pagar,
              generar_gasto: true,
              codigo_generacion_dte: parsed.codigo_generacion,
              notas: `Importado desde DTE de compra — ${parsed.numero_control}`,
            }])
            .select().single()
          if (compraErr) throw compraErr

          // Insertar items
          const itemsInsert = itemsConMatch.map(i => ({ ...i, compra_id: compra.id }))
          await sb.from('disabi_compra_items').insert(itemsInsert)

          // Actualizar stock y Kardex para items con match
          for (const item of itemsConMatch.filter(i => i.producto_id)) {
            const { data: prod } = await sb.from('disabi_productos')
              .select('stock_actual').eq('id', item.producto_id).single()
            if (prod) {
              const nuevoStock = prod.stock_actual + item.cantidad
              await sb.from('disabi_productos').update({ stock_actual: nuevoStock }).eq('id', item.producto_id)
              await sb.from('disabi_movimientos_inv').insert([{
                producto_id: item.producto_id, tipo: 'Entrada', cantidad: item.cantidad,
                stock_antes: prod.stock_actual, stock_despues: nuevoStock,
                motivo: `Compra DTE ${parsed.numero_control} — ${parsed.proveedor_nombre}`,
                fecha: parsed.fecha_emision,
              }])
            }
          }

          // Tipo de egreso: viene de la decisión tomada en la vista previa (por proveedor).
          // Si no se especificó, se usa 'operativo' como default conservador
          // (no infla Costo de Ventas por error).
          const tipoEgresoAsignado = tipoEgresoPorProveedor?.[parsed.proveedor_nombre] ?? 'operativo'

          await sb.from('disabi_gastos').insert([{
            fecha: parsed.fecha_emision,
            categoria: tipoEgresoAsignado === 'operativo' ? 'Servicios / Operativo' : 'Compra Importación',
            descripcion: `Compra DTE ${parsed.numero_control} — ${parsed.proveedor_nombre}`,
            monto: parsed.total_pagar, factura: 'Sí', proveedor: parsed.proveedor_nombre,
            tipo_egreso: tipoEgresoAsignado,
          }])

          resultados.push({
            nombre: doc.nombre, ok: true, numero_control: parsed.numero_control,
            items_creados: itemsInsert.length, items_sin_match: itemsSinMatch,
            tipo_egreso: tipoEgresoAsignado,
          })
        } catch (e: unknown) {
          resultados.push({ nombre: doc.nombre, ok: false, error: e instanceof Error ? e.message : 'Error desconocido' })
        }
      }

      const exitosos = resultados.filter(r => r.ok).length
      return NextResponse.json({ ok: true, exitosos, fallidos: resultados.length - exitosos, resultados })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    console.error('[api/compras-dte]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

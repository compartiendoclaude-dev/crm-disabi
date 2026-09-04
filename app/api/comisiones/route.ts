import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { segundoLunesHabil, calcISRComision } from '@/lib/utils'
import { PLANILLA } from '@/lib/constants'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

// Dado un precio con IVA y una categoría, encuentra el rango correcto
function matchRango(
  rangos: { id: string; categoria: string; precio_min_iva?: number | null; precio_max_iva?: number | null; precio_sin_iva: number; pct_comision: number; precio_iva_desc: string }[],
  categoria: string,
  precioIva: number
) {
  const candidatos = rangos
    .filter(r => r.categoria === categoria)
    .sort((a, b) => (b.precio_min_iva ?? 0) - (a.precio_min_iva ?? 0))

  for (const r of candidatos) {
    const min = r.precio_min_iva ?? 0
    const max = r.precio_max_iva ?? Infinity
    if (precioIva >= min && precioIva <= max) return r
  }
  return null
}

// Calcular ISR según tipo_calculo del empleado
function calcRetencion(tipo: 'empleado' | 'honorarios', comisionBruta: number): number {
  if (tipo === 'honorarios') {
    return parseFloat((comisionBruta * PLANILLA.RETENCION_HONORARIOS).toFixed(2))
  }
  return calcISRComision(comisionBruta)
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  try {
    // ── CALCULAR comisión de un empleado para un período ────────────────────
    if (action === 'calcular_comision') {
      const { empleado_id, periodo } = body
      if (!empleado_id || !periodo)
        return NextResponse.json({ error: 'Empleado y período requeridos' }, { status: 400 })

      // Leer datos del empleado
      const { data: emp } = await sb.from('disabi_empleados')
        .select('nombre, tipo_contrato, activo').eq('id', empleado_id).single()
      if (!emp) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

      const tipoCal: 'empleado' | 'honorarios' =
        (emp as { tipo_contrato?: string }).tipo_contrato === 'empleado' ? 'empleado' : 'honorarios'

      // Rango de fechas del período
      const [anio, mes] = periodo.split('-').map(Number)
      const ini = `${periodo}-01`
      const fin = `${periodo}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`

      // Leer rangos de comisión activos
      const { data: rangos } = await sb.from('disabi_comision_rangos')
        .select('*').eq('activo', true).order('categoria').order('orden')
      if (!rangos?.length)
        return NextResponse.json({ error: 'No hay rangos de comisión configurados' }, { status: 400 })

      // Leer ventas del período filtradas por vendedor_id cuando está asignado
      // Si el empleado tiene ventas asignadas directamente, usarlas; si no, usar todas (comportamiento legacy)
      // Incluir ventas Cobradas Y Pendientes (crédito devengado) — consistente con P&L
      // Excluir Borrador (no devengadas) y Liquidacion_Pendiente (aún no liquidan)
      const ventaItemsQuery = sb
        .from('disabi_venta_items')
        .select(`
          id, cantidad, precio_unitario, subtotal,
          producto:disabi_productos(id, nombre, categoria, precio_venta),
          venta:disabi_ventas!inner(fecha, cobro, nombre, vendedor_id, devolucion_estado)
        `)
        .gte('venta.fecha', ini)
        .lte('venta.fecha', fin)
        .in('venta.cobro', ['Cobrado', 'Pendiente', 'Liquidacion_Pendiente'])

      const { data: ventaItemsAll } = await ventaItemsQuery

      // Determinar si hay ventas con vendedor_id asignado para este empleado en el período
      // Excluir ventas totalmente devueltas (igual que P&L)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ventaItemsFiltradas = (ventaItemsAll ?? []).filter((vi: any) => {
        const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
        return venta?.devolucion_estado !== 'Devuelta'
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ventaItemsConVendedor = ventaItemsFiltradas.filter((vi: any) => {
        const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
        return venta?.vendedor_id === empleado_id
      })
      // Si hay ventas con vendedor asignado → usar solo esas (modo trazabilidad)
      // Si no → fallback a todas las ventas del período (modo legacy)
      const ventaItems = ventaItemsConVendedor.length > 0 ? ventaItemsConVendedor : ventaItemsFiltradas

      // Verificar crédito pendiente: solo de clientes atendidos por ESTE vendedor
      // Buscar ventas a crédito del vendedor → obtener nombres de clientes → verificar CxC activas
      // Si el vendedor no tiene ventas asignadas (modo legacy), revisar todas las CxC (comportamiento conservador)
      let tieneCreditoPendiente = false
      if (ventaItemsConVendedor.length > 0) {
        // Modo trazabilidad: solo los clientes del vendedor
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientesDelVendedor = Array.from(new Set((ventaItemsConVendedor as any[]).map(vi => {
          const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
          return (venta?.nombre ?? '').toLowerCase().trim()
        }).filter(Boolean)))

        if (clientesDelVendedor.length > 0) {
          const { data: cxcVendedor } = await sb.from('disabi_cxc')
            .select('id, cliente')
            .in('estado', ['Pendiente', 'Vencido', 'Parcial'])
          // Verificar si alguna CxC pertenece a un cliente del vendedor
          tieneCreditoPendiente = (cxcVendedor ?? []).some(cxc =>
            clientesDelVendedor.includes((cxc.cliente ?? '').toLowerCase().trim())
          )
        }
      } else {
        // Modo legacy: sin vendedor asignado → revisar todas (comportamiento conservador)
        const { data: cxcPendientes } = await sb.from('disabi_cxc')
          .select('id').in('estado', ['Pendiente', 'Vencido', 'Parcial']).limit(1)
        tieneCreditoPendiente = (cxcPendientes?.length ?? 0) > 0
      }

      // Leer devoluciones del período para descontar cantidades devueltas parcialmente
      // Término 5: "pedidos devueltos o no recibidos no se incluyen en el conteo"
      const { data: devolucionItems } = await sb
        .from('disabi_devolucion_items')
        .select('producto_id, cantidad, venta_item_id, devolucion:disabi_devoluciones!inner(estado, fecha)')
        .gte('devolucion.fecha', ini)
        .lte('devolucion.fecha', fin)
        .eq('devolucion.estado', 'Procesada')

      // Mapa de cantidades devueltas por venta_item_id
      const devueltosPorItem: Record<string, number> = {}
      const devueltosPorProducto: Record<string, number> = {}
      ;(devolucionItems ?? []).forEach((di: { producto_id?: string; cantidad: number; venta_item_id?: string }) => {
        if (di.venta_item_id) {
          devueltosPorItem[di.venta_item_id] = (devueltosPorItem[di.venta_item_id] ?? 0) + di.cantidad
        }
        if (di.producto_id) {
          devueltosPorProducto[di.producto_id] = (devueltosPorProducto[di.producto_id] ?? 0) + di.cantidad
        }
      })

      // Agrupar ventas por categoría y rango de precio, descontando devoluciones parciales
      const lineasMap: Record<string, {
        rango: typeof rangos[0]; cantidad: number
      }> = {}

      for (const vi of (ventaItems ?? []) as {
        id?: string; cantidad: number; precio_unitario: number
        producto?: { id?: string; nombre?: string; categoria?: string; precio_venta?: number } | null
      }[]) {
        const cat = vi.producto?.categoria ?? ''
        const precioIva = vi.precio_unitario

        const rango = matchRango(rangos, cat, precioIva)
        if (!rango) continue

        // Descontar unidades devueltas de este ítem específico
        const cantDevuelta = vi.id
          ? (devueltosPorItem[vi.id] ?? 0)
          : 0
        const cantComisionable = Math.max(0, vi.cantidad - cantDevuelta)
        if (cantComisionable === 0) continue

        const key = `${rango.id}`
        if (!lineasMap[key]) lineasMap[key] = { rango, cantidad: 0 }
        lineasMap[key].cantidad += cantComisionable
      }

      // Calcular comisión por línea
      const lineas = Object.values(lineasMap).map(({ rango, cantidad }) => ({
        rango_id:         rango.id,
        categoria:        rango.categoria,
        precio_iva_desc:  rango.precio_iva_desc,
        precio_sin_iva:   rango.precio_sin_iva,
        pct_comision:     rango.pct_comision,
        cantidad_vendida: cantidad,
        comision_linea:   parseFloat((cantidad * rango.precio_sin_iva * rango.pct_comision).toFixed(2)),
      }))

      const comisionBruta   = parseFloat(lineas.reduce((a, l) => a + l.comision_linea, 0).toFixed(2))
      const retencionISR    = calcRetencion(tipoCal, comisionBruta)
      const comisionNeta    = parseFloat((comisionBruta - retencionISR).toFixed(2))
      const fechaPagoProg   = segundoLunesHabil(anio, mes + 1) // se paga el mes siguiente

      // Indicar si se usó modo legacy (sin vendedor_id en ventas)
      const modoLegacy = ventaItemsConVendedor.length === 0 && (ventaItemsFiltradas?.length ?? 0) > 0

      return NextResponse.json({
        ok: true,
        preview: {
          empleado_nombre: (emp as { nombre: string }).nombre,
          tipo_calculo: tipoCal,
          periodo,
          fecha_pago_prog: fechaPagoProg,
          comision_bruta: comisionBruta,
          retencion_isr: retencionISR,
          comision_neta: comisionNeta,
          pct_retencion: tipoCal === 'honorarios' ? '10%' : 'Tabla ISR',
          bloqueado: tieneCreditoPendiente,
          modo_legacy: modoLegacy,
          lineas,
        },
      })
    }

    // ── GUARDAR registro de comisión ────────────────────────────────────────
    if (action === 'save_comision') {
      const { empleado_id, periodo, comision_bruta, retencion_isr, comision_neta,
              tipo_calculo, fecha_pago_prog, estado, notas, lineas } = body

      // Upsert del registro cabecera
      const { data: reg, error: regErr } = await sb.from('disabi_comision_registros')
        .upsert({
          empleado_id, periodo,
          comision_bruta, retencion_isr, comision_neta,
          tipo_calculo, fecha_pago_prog: fecha_pago_prog || null,
          estado: estado || (body.bloqueado ? 'Bloqueado' : 'Pendiente'),
          notas: notas || null,
        }, { onConflict: 'empleado_id,periodo' })
        .select().single()
      if (regErr) throw regErr

      // Eliminar líneas anteriores e insertar nuevas
      await sb.from('disabi_comision_lineas').delete().eq('comision_registro_id', reg.id)
      if (lineas?.length) {
        const lineasInsert = lineas.map((l: {
          rango_id?: string; categoria: string; precio_iva_desc: string
          precio_sin_iva: number; pct_comision: number; cantidad_vendida: number; comision_linea: number
        }) => ({ ...l, comision_registro_id: reg.id }))
        const { error: lErr } = await sb.from('disabi_comision_lineas').insert(lineasInsert)
        if (lErr) throw lErr
      }

      return NextResponse.json({ ok: true, id: reg.id })
    }

    // ── PAGAR comisión ──────────────────────────────────────────────────────
    if (action === 'pagar_comision') {
      const { id, fecha_pago_real } = body
      const fp = fecha_pago_real || new Date().toISOString().slice(0, 10)

      // Leer registro para trazabilidad
      const { data: reg } = await sb.from('disabi_comision_registros')
        .select('*, empleado:disabi_empleados(nombre, tipo_contrato)')
        .eq('id', id).single()
      if (!reg) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

      const { error } = await sb.from('disabi_comision_registros')
        .update({ estado: 'Pagado', fecha_pago_real: fp })
        .eq('id', id)
      if (error) throw error

      // Puente financiero: registrar egreso real en disabi_gastos
      const empNombre = (reg.empleado as { nombre?: string } | null)?.nombre ?? 'Vendedor'
      await sb.from('disabi_gastos').insert([{
        fecha:       fp,
        categoria:   'Comisiones',
        descripcion: `Pago comisión ${reg.periodo} — ${empNombre} [id:${id}]`,
        monto:       reg.comision_bruta,
        factura:     'Sí',
        proveedor:   empNombre,
        tipo_egreso: 'comision_venta',
      }])

      return NextResponse.json({ ok: true })
    }

    // ── ELIMINAR registro ───────────────────────────────────────────────────
    if (action === 'delete_comision') {
      const { id } = body
      await sb.from('disabi_comision_lineas').delete().eq('comision_registro_id', id)
      const { error } = await sb.from('disabi_comision_registros').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── OBTENER rangos ──────────────────────────────────────────────────────
    if (action === 'get_rangos') {
      const { data } = await sb.from('disabi_comision_rangos')
        .select('*').eq('activo', true).order('categoria').order('orden')
      return NextResponse.json({ ok: true, rangos: data ?? [] })
    }

    // ── GUARDAR rango (editar tabla maestra) ────────────────────────────────
    if (action === 'save_rango') {
      const { editId, categoria, precio_iva_desc, precio_min_iva, precio_max_iva, precio_sin_iva, pct_comision, orden } = body
      const obj = { categoria, precio_iva_desc, precio_min_iva: precio_min_iva || null, precio_max_iva: precio_max_iva || null, precio_sin_iva, pct_comision, orden: orden || 1 }
      if (editId) {
        const { error } = await sb.from('disabi_comision_rangos').update(obj).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await sb.from('disabi_comision_rangos').insert([obj])
        if (error) throw error
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/comisiones]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

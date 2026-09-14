import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { bloqueadoPorCierre } from '@/lib/cierre-server'
import { diasEntre, today } from '@/lib/utils'
import { requirePermisoEscritura } from '@/lib/permisos-server'
import { crearAsientoContable, borrarAsientoDeOrigen, CUENTA } from '@/lib/contabilidad-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

// ── Límite de crédito de proveedor (dinero y/o días) ──────────────────────────
// disabi_proveedores.limite_credito y .dias_credito existían en el formulario
// pero nunca se leían al comprar a crédito — un proveedor podía quedar
// sobregirado sin que nada lo impidiera. Ninguno de los dos límites es
// obligatorio: el "límite" del proveedor puede referirse a un monto máximo en
// dólares, a un plazo máximo en días, a ambos, o a ninguno (si no se definió).
// Solo se valida lo que el proveedor realmente tenga configurado (> 0).
async function checkLimiteCreditoProveedor(
  sb: Awaited<ReturnType<typeof createClient>>,
  proveedorNombre: string,
  fechaCompra: string,
  fechaVencePago: string,
  montoCompra: number,
  excluirOrigenId?: string,
): Promise<string | null> {
  const { data: prov } = await sb.from('disabi_proveedores')
    .select('limite_credito, dias_credito')
    .ilike('nombre', proveedorNombre)
    .maybeSingle()
  if (!prov) return null // proveedor no catalogado en disabi_proveedores — sin dato, no se puede validar

  if (prov.dias_credito && prov.dias_credito > 0) {
    const dias = diasEntre(fechaCompra, fechaVencePago)
    if (dias > prov.dias_credito) {
      return `El proveedor "${proveedorNombre}" tiene un plazo de crédito máximo de ${prov.dias_credito} días y esta compra pide ${dias}.`
    }
  }

  if (prov.limite_credito && prov.limite_credito > 0) {
    const { data: cppAbiertas } = await sb.from('disabi_cpp')
      .select('monto_pendiente, origen_id')
      .ilike('proveedor', proveedorNombre)
      .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
    const saldoActual = (cppAbiertas ?? [])
      .filter(c => !(excluirOrigenId && c.origen_id === excluirOrigenId))
      .reduce((a, c) => a + (c.monto_pendiente ?? 0), 0)
    const totalConEsta = parseFloat((saldoActual + montoCompra).toFixed(2))
    if (totalConEsta > prov.limite_credito) {
      return `El proveedor "${proveedorNombre}" tiene un límite de crédito de $${prov.limite_credito.toFixed(2)} — con esta compra la deuda abierta con él sería de $${totalConEsta.toFixed(2)}.`
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  // Hallazgo #7 (evaluación CPP): este endpoint solo verificaba que hubiera sesión,
  // nunca el rol — cualquier usuario autenticado podía crear/editar/borrar compras
  // e importaciones sin importar su permiso sobre el módulo. Una sola verificación
  // aquí cubre todas las acciones del archivo, igual que en /api/ventas.
  if (!(await requirePermisoEscritura(user.id, 'compras')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar Compras' }, { status: 403 })

  const body = await req.json()
  const { action } = body

  try {
    // ── IMPORTACIÓN DESDE PDF/IMAGEN: crear completa de una sola vez ───────
    // Endpoint dedicado y aislado — no depende del modal ni de estados previos.
    // Recibe los items ya extraídos por OCR y crea compra + items + stock + gasto + CPP.
    if (action === 'crear_importacion_ocr') {
      const {
        proveedor, fecha, numero, items,
        generar_gasto, fecha_vence_pago,
      } = body

      if (!proveedor?.trim() || !fecha || !items?.length)
        return NextResponse.json({ error: 'Proveedor, fecha e items son requeridos' }, { status: 400 })

      const bloqueoOcr = await bloqueadoPorCierre(fecha)
      if (bloqueoOcr) return NextResponse.json({ error: bloqueoOcr }, { status: 409 })

      const montoTotal = items.reduce((a: number, i: { subtotal: number }) => a + (i.subtotal || 0), 0)

      if (fecha_vence_pago) {
        const errorLimite = await checkLimiteCreditoProveedor(sb, proveedor.trim(), fecha, fecha_vence_pago, montoTotal)
        if (errorLimite) return NextResponse.json({ error: errorLimite }, { status: 409 })
      }

      const { count } = await sb.from('disabi_compras').select('*', { count: 'exact', head: true })
      const numeroFinal = numero?.trim() || ('IMP-' + String((count ?? 0) + 1).padStart(4, '0'))

      // 1. Crear la compra
      const { data: compra, error: compraErr } = await sb.from('disabi_compras')
        .insert([{
          numero: numeroFinal, proveedor: proveedor.trim(), fecha,
          estado: 'Recibido', tipo: 'Importacion', moneda: 'USD',
          monto_total: montoTotal, impuestos: 0, monto_final: montoTotal,
          generar_gasto: !!generar_gasto,
          fecha_vence_pago: fecha_vence_pago || null,
          notas: `Importado vía OCR — ${items.length} items`,
        }])
        .select().single()
      if (compraErr) throw compraErr

      // 2. Crear items
      const itemsInsert = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }) => ({
        compra_id: compra.id,
        producto_id: i.producto_id || null,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        costo_unitario: i.precio_unitario,
        subtotal: i.subtotal,
      }))
      const { error: itemsErr } = await sb.from('disabi_compra_items').insert(itemsInsert)
      if (itemsErr) throw itemsErr

      // 3. Actualizar stock y Kardex para items con producto_id
      const erroresStock: string[] = []
      for (const item of items.filter((i: { producto_id?: string }) => i.producto_id)) {
        try {
          const { data: prod } = await sb.from('disabi_productos')
            .select('stock_actual').eq('id', item.producto_id).single()
          if (prod) {
            const nuevoStock = prod.stock_actual + item.cantidad
            await sb.from('disabi_productos').update({ stock_actual: nuevoStock }).eq('id', item.producto_id)
            await sb.from('disabi_movimientos_inv').insert([{
              producto_id: item.producto_id, tipo: 'Entrada', cantidad: item.cantidad,
              stock_antes: prod.stock_actual, stock_despues: nuevoStock,
              motivo: `Importación ${numeroFinal} — ${proveedor.trim()}`, fecha,
            }])
          }
        } catch {
          erroresStock.push(item.descripcion)
        }
      }

      // 4. (Ya no se registra un "gasto" espejo aquí.) El Costo de Ventas se calcula
      //    directamente desde disabi_compras (tipo='importacion', estado='Recibido')
      //    — crear también un gasto duplicaría el costo en el Estado de Resultados.

      // 5. Crear CPP si tiene fecha de vencimiento
      if (fecha_vence_pago) {
        const { count: cppCount } = await sb.from('disabi_cpp').select('*', { count: 'exact', head: true })
        await sb.from('disabi_cpp').insert([{
          numero_doc: 'CPP-' + String((cppCount ?? 0) + 1).padStart(4, '0'),
          proveedor: proveedor.trim(), fecha_emision: fecha, fecha_vence: fecha_vence_pago,
          monto_total: montoTotal, monto_pendiente: montoTotal, monto_pagado: 0,
          estado: 'Pendiente', origen: 'compra_importacion', origen_id: compra.id,
          notas: `Generado automáticamente desde importación ${numeroFinal}`,
        }])
      }

      // Contabilidad (Fase 2): esta vía siempre entra como 'Recibido' (línea
      // arriba, al crear la compra) — el costo se reconoce de una vez, no hay
      // paso intermedio por Mercadería en Tránsito.
      await crearAsientoContable(sb, {
        fecha,
        concepto: `Importación ${numeroFinal} — ${proveedor.trim()}`,
        origenTabla: 'disabi_compras',
        origenId: compra.id,
        lineas: [
          { cuenta: CUENTA.COSTO_VENTAS_MERCADERIA, debe: montoTotal, descripcion: 'Costo de mercadería recibida' },
          fecha_vence_pago
            ? { cuenta: CUENTA.CXP_PROVEEDORES, haber: montoTotal, descripcion: `CxP a ${proveedor.trim()}` }
            : { cuenta: CUENTA.BANCOS, haber: montoTotal, descripcion: 'Pago de contado' },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({
        ok: true, compra_id: compra.id, numero: numeroFinal,
        items_creados: itemsInsert.length,
        productos_sin_match: items.filter((i: { producto_id?: string }) => !i.producto_id).length,
        errores_stock: erroresStock,
      })
    }

    // ── IMPORTACIÓN: guardar ────────────────────────────────────────────────
    if (action === 'save_importacion') {
      const {
        editId, proveedor, fecha, fecha_recepcion, numero,
        tipo_cambio, moneda, estado, flete, impuestos,
        generar_gasto, fecha_vence_pago, items,
      } = body

      if (!proveedor?.trim() || !fecha)
        return NextResponse.json({ error: 'Proveedor y fecha son requeridos' }, { status: 400 })
      if (!items?.length)
        return NextResponse.json({ error: 'Agrega al menos un item' }, { status: 400 })

      const bloqueoImp = await bloqueadoPorCierre(fecha_recepcion || fecha)
      if (bloqueoImp) return NextResponse.json({ error: bloqueoImp }, { status: 409 })

      const subtotal   = items.reduce((a: number, i: { subtotal: number }) => a + i.subtotal, 0)
      const monto_final = parseFloat((subtotal + (flete || 0) + (impuestos || 0)).toFixed(2))

      let numCompra = numero?.trim() || null
      if (!numCompra && !editId) {
        const { count } = await sb.from('disabi_compras').select('*', { count: 'exact', head: true })
        numCompra = 'IMP-' + String((count ?? 0) + 1).padStart(4, '0')
      }

      const obj = {
        numero: numCompra, proveedor: proveedor.trim(), fecha,
        fecha_recepcion: fecha_recepcion || null,
        tipo: 'importacion', moneda: moneda || 'USD',
        tipo_cambio: parseFloat(tipo_cambio) || 1,
        estado: estado || 'Pedido',
        monto_total: subtotal, flete: flete || 0,
        impuestos: impuestos || 0, monto_final,
        generar_gasto: !!generar_gasto,
        fecha_vence_pago: fecha_vence_pago || null,
      }

      // Corregido: antes la CPP generada automáticamente solo se creaba al
      // guardar la importación por primera vez (rama !editId) — si después
      // editabas el monto final, el proveedor o la fecha de vencimiento de
      // pago, la CPP ya creada se quedaba con los datos viejos para siempre.
      // Ahora, al editar, se busca la CPP vinculada ANTES de escribir nada
      // (se busca por origen_id — la columna que realmente usa este código
      // para el vínculo, no la FK compra_id que quedó sin usar) y se valida
      // primero, igual que se hizo para venta↔CxC: si esa CPP ya tiene pagos
      // reales y el cambio intenta quitarle la fecha de vencimiento (como
      // diciendo "esto ya no fue a crédito"), se rechaza el guardado en vez
      // de dejar un pago huérfano sin factura que lo respalde.
      let cppExistente: { id: string; monto_pagado: number | null } | null = null
      if (editId) {
        const { data } = await sb.from('disabi_cpp')
          .select('id, monto_pagado')
          .eq('origen_id', editId).eq('origen', 'compra_importacion')
          .maybeSingle()
        cppExistente = data

        if (cppExistente && (cppExistente.monto_pagado ?? 0) > 0 && !fecha_vence_pago) {
          return NextResponse.json({
            error: 'Esta importación ya tiene una CPP con pagos registrados — no se puede quitar la fecha de vencimiento de pago. Ajusta o elimina la CPP directamente desde Finanzas primero.',
          }, { status: 409 })
        }
      }

      if (fecha_vence_pago) {
        const errorLimite = await checkLimiteCreditoProveedor(sb, proveedor.trim(), fecha, fecha_vence_pago, monto_final, editId)
        if (errorLimite) return NextResponse.json({ error: errorLimite }, { status: 409 })
      }

      let compraId: string
      if (editId) {
        const { error } = await sb.from('disabi_compras').update(obj).eq('id', editId)
        if (error) throw error
        await sb.from('disabi_compra_items').delete().eq('compra_id', editId)
        compraId = editId
      } else {
        const { data, error } = await sb.from('disabi_compras').insert([obj]).select().single()
        if (error) throw error
        compraId = data.id
      }

      const itemsInsert = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }) => ({
        compra_id:      compraId,
        producto_id:    i.producto_id || null,
        descripcion:    i.descripcion,
        cantidad:       i.cantidad,
        costo_unitario: i.precio_unitario,
        subtotal:       i.subtotal,
      }))
      const { error: iErr } = await sb.from('disabi_compra_items').insert(itemsInsert)
      if (iErr) throw iErr

      // Si se recibió Y es nueva (no edición) → actualizar stock
      if (estado === 'Recibido' && !editId) {
        for (const item of items.filter((i: { producto_id?: string }) => i.producto_id)) {
          const { data: prod } = await sb.from('disabi_productos')
            .select('stock_actual').eq('id', item.producto_id).single()
          if (prod) {
            const nuevStock = (prod.stock_actual || 0) + item.cantidad
            await sb.from('disabi_productos')
              .update({ stock_actual: nuevStock }).eq('id', item.producto_id)
            await sb.from('disabi_movimientos_inv').insert([{
              producto_id: item.producto_id, tipo: 'Entrada',
              cantidad: item.cantidad, stock_antes: prod.stock_actual,
              stock_despues: nuevStock,
              motivo: 'Recepción compra ' + (numCompra || compraId),
              costo_unitario: item.precio_unitario,
              fecha: fecha_recepcion || fecha,
            }])
          }
        }
      }

      // Puente: Si tiene fecha de vencimiento de pago → crear/resincronizar la CPP.
      if (!editId) {
        // Creación — igual que antes.
        if (body.fecha_vence_pago) {
          const { count: cppCount } = await sb.from('disabi_cpp')
            .select('*', { count: 'exact', head: true })
          const cppNum = 'CPP-' + String((cppCount ?? 0) + 1).padStart(4, '0')
          await sb.from('disabi_cpp').insert([{
            numero_doc:       cppNum,
            proveedor:        proveedor.trim(),
            fecha_emision:    fecha,
            fecha_vence:      body.fecha_vence_pago,
            monto_total:      monto_final,
            monto_pendiente:  monto_final,
            monto_pagado:     0,
            estado:           'Pendiente',
            origen:           'compra_importacion',
            origen_id:        compraId,
            compra_id:        compraId,
            notas:            `Generado automáticamente desde importación ${numCompra ?? ''}`,
          }])
        }
      } else if (cppExistente) {
        // Edición de una importación que YA tenía CPP vinculada.
        if (!body.fecha_vence_pago) {
          // Sin pagos (ya validado arriba) y ya no se quiere crédito → limpiar la CPP huérfana.
          await sb.from('disabi_cpp').delete().eq('id', cppExistente.id)
        } else {
          // Preserva monto_pagado — nunca se toca aquí, igual que en save_cpp de Finanzas.
          const pagado    = cppExistente.monto_pagado ?? 0
          const pendiente = Math.max(0, parseFloat((monto_final - pagado).toFixed(2)))
          const nuevoEstado = pendiente <= 0 ? 'Pagado' : pagado > 0 ? 'Parcial' : 'Pendiente'
          await sb.from('disabi_cpp').update({
            proveedor:       proveedor.trim(),
            fecha_emision:   fecha,
            fecha_vence:     body.fecha_vence_pago,
            monto_total:     monto_final,
            monto_pendiente: pendiente,
            estado:          nuevoEstado,
            compra_id:       compraId,
          }).eq('id', cppExistente.id)
        }
      } else if (body.fecha_vence_pago) {
        // Edición de una importación que NO tenía CPP (se guardó sin fecha de
        // vencimiento) y ahora se le agrega una — antes esto se perdía en
        // silencio; ahora crea la CPP que debió existir desde un inicio.
        const { count: cppCount } = await sb.from('disabi_cpp')
          .select('*', { count: 'exact', head: true })
        const cppNum = 'CPP-' + String((cppCount ?? 0) + 1).padStart(4, '0')
        await sb.from('disabi_cpp').insert([{
          numero_doc:       cppNum,
          proveedor:        proveedor.trim(),
          fecha_emision:    fecha,
          fecha_vence:      body.fecha_vence_pago,
          monto_total:      monto_final,
          monto_pendiente:  monto_final,
          monto_pagado:     0,
          estado:           'Pendiente',
          origen:           'compra_importacion',
          origen_id:        compraId,
          compra_id:        compraId,
          notas:            `Generado automáticamente desde importación ${numCompra ?? ''} (agregada al editar)`,
        }])
      }

      // ══════════════════════════════════════════════════════════════════
      // CONTABILIDAD (Fase 2) — si el estado guardado es 'Recibido', el costo
      // se reconoce de una vez (Costo de Ventas); si no (Pedido, En tránsito,
      // etc.), la mercadería es un activo en tránsito — se reclasifica a
      // Costo de Ventas cuando update_estado_compra la marque Recibida (ver
      // esa acción más abajo). En edición se resincroniza completo: se borra
      // el asiento anterior y se postea uno solo consistente con el estado
      // actual, en vez de arrastrar entradas de estados ya superados.
      // ══════════════════════════════════════════════════════════════════
      if (editId) await borrarAsientoDeOrigen(sb, 'disabi_compras', compraId)
      const recibida = obj.estado === 'Recibido'
      await crearAsientoContable(sb, {
        fecha: fecha_recepcion || fecha,
        concepto: `Importación ${numCompra ?? compraId} — ${proveedor.trim()}`,
        origenTabla: 'disabi_compras',
        origenId: compraId,
        lineas: [
          {
            cuenta: recibida ? CUENTA.COSTO_VENTAS_MERCADERIA : CUENTA.MERCADERIA_TRANSITO,
            debe: monto_final,
            descripcion: recibida ? 'Costo de mercadería recibida' : 'Mercadería en tránsito',
          },
          body.fecha_vence_pago
            ? { cuenta: CUENTA.CXP_PROVEEDORES, haber: monto_final, descripcion: `CxP a ${proveedor.trim()}` }
            : { cuenta: CUENTA.BANCOS, haber: monto_final, descripcion: 'Pago de contado' },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({ ok: true, id: compraId })
    }

    // ── IMPORTACIÓN: cambiar estado ─────────────────────────────────────────
    if (action === 'update_estado_compra') {
      const { id, estado, fecha_recepcion } = body

      // CRÍTICO: leer estado ANTERIOR antes de actualizar para evitar race condition
      const { data: compraAnterior } = await sb.from('disabi_compras')
        .select('estado, generar_gasto, numero, proveedor, monto_total, monto_final, fecha')
        .eq('id', id).single()

      const bloqueoEstado = await bloqueadoPorCierre(fecha_recepcion || compraAnterior?.fecha || '')
      if (bloqueoEstado) return NextResponse.json({ error: bloqueoEstado }, { status: 409 })

      const updateObj: Record<string, unknown> = { estado }
      if (fecha_recepcion) updateObj.fecha_recepcion = fecha_recepcion

      const { error } = await sb.from('disabi_compras').update(updateObj).eq('id', id)
      if (error) throw error

      // Calcular ANTES del bloque if para que esté disponible en el de generar_gasto
      const yaEstabaRecibido = compraAnterior?.estado === 'Recibido'

      // Si pasa a Recibido → actualizar stock (solo si NO estaba ya Recibido)
      if (estado === 'Recibido') {

        if (!yaEstabaRecibido) {
          const { data: compraData } = await sb.from('disabi_compras')
            .select('*, items:disabi_compra_items(*)').eq('id', id).single()
          if (compraData?.items) {
            for (const item of compraData.items.filter((i: { producto_id?: string }) => i.producto_id)) {
              const { data: prod } = await sb.from('disabi_productos')
                .select('stock_actual').eq('id', item.producto_id).single()
              if (prod) {
                const nuevStock = (prod.stock_actual || 0) + item.cantidad
                await sb.from('disabi_productos').update({ stock_actual: nuevStock }).eq('id', item.producto_id)
                await sb.from('disabi_movimientos_inv').insert([{
                  producto_id: item.producto_id, tipo: 'Entrada',
                  cantidad: item.cantidad, stock_antes: prod.stock_actual,
                  stock_despues: nuevStock,
                  motivo: 'Recepción compra ' + (compraData.numero || id),
                  costo_unitario: item.precio_unitario,
                  fecha: fecha_recepcion || new Date().toISOString().slice(0, 10),
                }])
              }
            }
          }

          // Contabilidad (Fase 2): la mercadería deja de estar "en tránsito" y
          // se reconoce como costo — asiento ADICIONAL al de la creación de la
          // compra (no se borra ese), mismo origen para que quede todo junto
          // si la compra se elimina más adelante.
          if (compraAnterior?.monto_final) {
            await crearAsientoContable(sb, {
              fecha: fecha_recepcion || compraAnterior.fecha || today(),
              concepto: `Recepción de importación ${compraAnterior.numero ?? id} — ${compraAnterior.proveedor}`,
              origenTabla: 'disabi_compras',
              origenId: id,
              lineas: [
                { cuenta: CUENTA.COSTO_VENTAS_MERCADERIA, debe: compraAnterior.monto_final, descripcion: 'Costo de mercadería recibida' },
                { cuenta: CUENTA.MERCADERIA_TRANSITO, haber: compraAnterior.monto_final, descripcion: 'Salida de mercadería en tránsito' },
              ],
              creadoPor: user.id,
            })
          }
        }
      }
      // (Ya no se registra un "gasto" espejo al recibir una importación — ver nota
      // arriba en crear_importacion_ocr. El Costo de Ventas lee disabi_compras directo.)
      return NextResponse.json({ ok: true })
    }

    // ── COMPRA LOCAL: guardar (va a disabi_gastos) ──────────────────────────
    if (action === 'save_compra_local') {
      const { editId, fecha, proveedor, descripcion, monto, partida, numero_factura, fecha_vence_pago } = body

      if (!fecha || !proveedor?.trim() || !descripcion?.trim() || !monto)
        return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 })

      const bloqueoLocal = await bloqueadoPorCierre(fecha)
      if (bloqueoLocal) return NextResponse.json({ error: bloqueoLocal }, { status: 409 })

      const montoNum = parseFloat(monto)

      // Hallazgo #4: las compras locales a crédito eran invisibles para Finanzas —
      // nunca generaban CPP ni quedaba registrado un plazo de pago. Ahora, igual que
      // en las importaciones, si se define fecha_vence_pago se crea/resincroniza
      // automáticamente una CPP vinculada (origen='compra_local'). compra_id se deja
      // en null a propósito: esa columna es una FK a disabi_compras y las compras
      // locales viven en disabi_gastos, una tabla distinta.
      let cppExistenteLocal: { id: string; monto_pagado: number | null } | null = null
      if (editId) {
        const { data } = await sb.from('disabi_cpp')
          .select('id, monto_pagado')
          .eq('origen_id', editId).eq('origen', 'compra_local')
          .maybeSingle()
        cppExistenteLocal = data

        if (cppExistenteLocal && (cppExistenteLocal.monto_pagado ?? 0) > 0 && !fecha_vence_pago) {
          return NextResponse.json({
            error: 'Esta compra local ya tiene una CPP con pagos registrados — no se puede quitar la fecha de vencimiento de pago. Ajusta o elimina la CPP directamente desde Finanzas primero.',
          }, { status: 409 })
        }
      }

      if (fecha_vence_pago) {
        const errorLimite = await checkLimiteCreditoProveedor(sb, proveedor.trim(), fecha, fecha_vence_pago, montoNum, editId)
        if (errorLimite) return NextResponse.json({ error: errorLimite }, { status: 409 })
      }

      const obj = {
        fecha,
        categoria:   partida || 'Compra Local',
        descripcion: descripcion.trim() + ' — ' + proveedor.trim(),
        monto:       montoNum,
        factura:     numero_factura?.trim() || 'Si',
        proveedor:   proveedor.trim(),
        tipo_compra: 'Local',
        tipo_egreso: 'compra_local',  // clasificador para Estado de Resultados
        fecha_vence_pago: fecha_vence_pago || null,
      }

      let gastoId: string
      if (editId) {
        const { error } = await sb.from('disabi_gastos').update(obj).eq('id', editId)
        if (error) throw error
        gastoId = editId
      } else {
        const { data, error } = await sb.from('disabi_gastos').insert([obj]).select().single()
        if (error) throw error
        gastoId = data.id
      }

      if (!editId) {
        if (fecha_vence_pago) {
          const { count: cppCount } = await sb.from('disabi_cpp').select('*', { count: 'exact', head: true })
          await sb.from('disabi_cpp').insert([{
            numero_doc:      'CPP-' + String((cppCount ?? 0) + 1).padStart(4, '0'),
            proveedor:       proveedor.trim(),
            fecha_emision:   fecha,
            fecha_vence:     fecha_vence_pago,
            monto_total:     montoNum,
            monto_pendiente: montoNum,
            monto_pagado:    0,
            estado:          'Pendiente',
            origen:          'compra_local',
            origen_id:       gastoId,
            notas:           `Generado automáticamente desde compra local — ${descripcion.trim()}`,
          }])
        }
      } else if (cppExistenteLocal) {
        if (!fecha_vence_pago) {
          await sb.from('disabi_cpp').delete().eq('id', cppExistenteLocal.id)
        } else {
          const pagado    = cppExistenteLocal.monto_pagado ?? 0
          const pendiente = Math.max(0, parseFloat((montoNum - pagado).toFixed(2)))
          const nuevoEstado = pendiente <= 0 ? 'Pagado' : pagado > 0 ? 'Parcial' : 'Pendiente'
          await sb.from('disabi_cpp').update({
            proveedor:       proveedor.trim(),
            fecha_emision:   fecha,
            fecha_vence:     fecha_vence_pago,
            monto_total:     montoNum,
            monto_pendiente: pendiente,
            estado:          nuevoEstado,
          }).eq('id', cppExistenteLocal.id)
        }
      } else if (fecha_vence_pago) {
        const { count: cppCount } = await sb.from('disabi_cpp').select('*', { count: 'exact', head: true })
        await sb.from('disabi_cpp').insert([{
          numero_doc:      'CPP-' + String((cppCount ?? 0) + 1).padStart(4, '0'),
          proveedor:       proveedor.trim(),
          fecha_emision:   fecha,
          fecha_vence:     fecha_vence_pago,
          monto_total:     montoNum,
          monto_pendiente: montoNum,
          monto_pagado:    0,
          estado:          'Pendiente',
          origen:          'compra_local',
          origen_id:       gastoId,
          notas:           `Generado automáticamente desde compra local (agregada al editar) — ${descripcion.trim()}`,
        }])
      }

      // Contabilidad (Fase 2): compra local — se reconoce el gasto de una vez
      // (no hay tránsito, a diferencia de las importaciones). En edición se
      // resincroniza: se borra el asiento anterior y se postea de nuevo.
      if (editId) await borrarAsientoDeOrigen(sb, 'disabi_gastos', gastoId)
      await crearAsientoContable(sb, {
        fecha,
        concepto: `Compra local — ${descripcion.trim()} — ${proveedor.trim()}`,
        origenTabla: 'disabi_gastos',
        origenId: gastoId,
        lineas: [
          { cuenta: CUENTA.COMPRAS_LOCALES_SUMINISTROS, debe: montoNum, descripcion: descripcion.trim() },
          fecha_vence_pago
            ? { cuenta: CUENTA.CXP_PROVEEDORES, haber: montoNum, descripcion: `CxP a ${proveedor.trim()}` }
            : { cuenta: CUENTA.BANCOS, haber: montoNum, descripcion: 'Pago de contado' },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({ ok: true, id: gastoId })
    }

    // ── COMPRA LOCAL / IMPORTACIÓN: eliminar ────────────────────────────────
    if (action === 'delete_compra') {
      const { id, tabla } = body
      if (tabla === 'gastos') {
        const { data: gastoDelC } = await sb.from('disabi_gastos').select('fecha').eq('id', id).single()
        const bloqueoDelG = await bloqueadoPorCierre(gastoDelC?.fecha ?? '')
        if (bloqueoDelG) return NextResponse.json({ error: bloqueoDelG }, { status: 409 })

        // Si esta compra local generó una CPP (hallazgo #4), no dejarla huérfana al
        // borrar la compra: si ya tiene pagos registrados se bloquea el borrado (hay
        // que resolver la CPP desde Finanzas primero); si no tiene pagos, se borra junto.
        const { data: cppDelLocal } = await sb.from('disabi_cpp')
          .select('id, monto_pagado')
          .eq('origen_id', id).eq('origen', 'compra_local')
          .maybeSingle()
        if (cppDelLocal) {
          if ((cppDelLocal.monto_pagado ?? 0) > 0) {
            return NextResponse.json({
              error: 'Esta compra local tiene una CPP con pagos registrados — ajusta o elimina la CPP desde Finanzas antes de borrar la compra.',
            }, { status: 409 })
          }
          await sb.from('disabi_cpp').delete().eq('id', cppDelLocal.id)
        }

        // Contabilidad (Fase 2): no dejar el asiento de esta compra local huérfano.
        await borrarAsientoDeOrigen(sb, 'disabi_gastos', id)

        const { error } = await sb.from('disabi_gastos').delete().eq('id', id)
        if (error) throw error
      } else {
        // Si la importación estaba Recibida → revertir stock antes de eliminar
        const { data: compraAElim } = await sb.from('disabi_compras')
          .select('estado, numero, fecha, fecha_recepcion').eq('id', id).single()

        const bloqueoDelC = await bloqueadoPorCierre(compraAElim?.fecha_recepcion || compraAElim?.fecha || '')
        if (bloqueoDelC) return NextResponse.json({ error: bloqueoDelC }, { status: 409 })

        // Hallazgo #6: borrar una importación con CPP vinculada la dejaba huérfana
        // (la CPP seguía existiendo, con origen_id apuntando a una compra que ya no
        // existe, invisible desde Compras pero todavía viva en Finanzas). Mismo
        // criterio que en compras locales: si ya tiene pagos registrados se bloquea
        // el borrado; si no, se borra junto con la compra.
        const { data: cppDelImp } = await sb.from('disabi_cpp')
          .select('id, monto_pagado')
          .eq('origen_id', id).eq('origen', 'compra_importacion')
          .maybeSingle()
        if (cppDelImp) {
          if ((cppDelImp.monto_pagado ?? 0) > 0) {
            return NextResponse.json({
              error: 'Esta importación tiene una CPP con pagos registrados — ajusta o elimina la CPP desde Finanzas antes de borrar la compra.',
            }, { status: 409 })
          }
          await sb.from('disabi_cpp').delete().eq('id', cppDelImp.id)
        }

        if (compraAElim?.estado === 'Recibido') {
          const { data: itemsARevertir } = await sb.from('disabi_compra_items')
            .select('producto_id, cantidad, precio_unitario').eq('compra_id', id)

          for (const item of (itemsARevertir ?? []).filter(i => i.producto_id)) {
            const { data: prod } = await sb.from('disabi_productos')
              .select('stock_actual').eq('id', item.producto_id).single()
            if (prod) {
              const nuevoStock = Math.max(0, prod.stock_actual - item.cantidad)
              await sb.from('disabi_productos')
                .update({ stock_actual: nuevoStock }).eq('id', item.producto_id)
              await sb.from('disabi_movimientos_inv').insert([{
                producto_id:   item.producto_id,
                tipo:          'Salida',
                cantidad:      item.cantidad,
                stock_antes:   prod.stock_actual,
                stock_despues: nuevoStock,
                motivo:        `Reversión por eliminación de importación ${compraAElim.numero ?? id}`,
                fecha:         new Date().toISOString().slice(0, 10),
              }])
            }
          }
        }

        // Contabilidad (Fase 2): no dejar huérfano ni el asiento de creación ni
        // el de recepción de esta importación (ambos comparten origen_id).
        await borrarAsientoDeOrigen(sb, 'disabi_compras', id)

        await sb.from('disabi_compra_items').delete().eq('compra_id', id)
        const { error } = await sb.from('disabi_compras').delete().eq('id', id)
        if (error) throw error
      }
      return NextResponse.json({ ok: true })
    }

    // ── Obtener items de una compra ─────────────────────────────────────────
    if (action === 'get_items') {
      const { compra_id } = body
      const { data } = await sb.from('disabi_compra_items')
        .select('id, producto_id, descripcion, cantidad, costo_unitario, subtotal, producto:disabi_productos(nombre, codigo)')
        .eq('compra_id', compra_id)
        .order('id')
      return NextResponse.json({ ok: true, items: data ?? [] })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/compras]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
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

      const montoTotal = items.reduce((a: number, i: { subtotal: number }) => a + (i.subtotal || 0), 0)

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

      // 4. Registrar gasto de costo de ventas
      if (generar_gasto) {
        await sb.from('disabi_gastos').insert([{
          fecha, categoria: 'Compra Importación',
          descripcion: `Importación ${numeroFinal} — ${proveedor.trim()}`,
          monto: montoTotal, factura: 'Sí', proveedor: proveedor.trim(),
          tipo_egreso: 'compra_local',
        }])
      }

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

      // Puente: Si tiene fecha de vencimiento de pago → crear CPP automáticamente
      if (body.fecha_vence_pago && !editId) {
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
          notas:            `Generado automáticamente desde importación ${numCompra ?? ''}`,
        }])
      }

      return NextResponse.json({ ok: true, id: compraId })
    }

    // ── IMPORTACIÓN: cambiar estado ─────────────────────────────────────────
    if (action === 'update_estado_compra') {
      const { id, estado, fecha_recepcion } = body
      const updateObj: Record<string, unknown> = { estado }
      if (fecha_recepcion) updateObj.fecha_recepcion = fecha_recepcion

      // CRÍTICO: leer estado ANTERIOR antes de actualizar para evitar race condition
      const { data: compraAnterior } = await sb.from('disabi_compras')
        .select('estado, generar_gasto, numero, proveedor, monto_total, monto_final, fecha')
        .eq('id', id).single()

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
        }
      }
      // Puente adicional: si generar_gasto=true y acaba de pasar a Recibido → registrar en gastos
      const debeGenerarGasto = estado === 'Recibido' &&
        !yaEstabaRecibido &&
        (body.generar_gasto || compraAnterior?.generar_gasto)
      if (debeGenerarGasto && compraAnterior) {
        await sb.from('disabi_gastos').insert([{
          fecha:       compraAnterior.fecha,
          categoria:   'Compra Importación',
          descripcion: `Recepción importación ${compraAnterior.numero ?? id} — ${compraAnterior.proveedor}`,
          monto:       compraAnterior.monto_final ?? compraAnterior.monto_total,
          factura:     'Sí',
          proveedor:   compraAnterior.proveedor,
          tipo_egreso: 'compra_local',
          tipo_compra: 'Local',
        }])
      }
      return NextResponse.json({ ok: true })
    }

    // ── COMPRA LOCAL: guardar (va a disabi_gastos) ──────────────────────────
    if (action === 'save_compra_local') {
      const { editId, fecha, proveedor, descripcion, monto, partida, numero_factura } = body

      if (!fecha || !proveedor?.trim() || !descripcion?.trim() || !monto)
        return NextResponse.json({ error: 'Todos los campos son requeridos' }, { status: 400 })

      const obj = {
        fecha,
        categoria:   partida || 'Compra Local',
        descripcion: descripcion.trim() + ' — ' + proveedor.trim(),
        monto:       parseFloat(monto),
        factura:     numero_factura?.trim() || 'Si',
        proveedor:   proveedor.trim(),
        tipo_compra: 'Local',
        tipo_egreso: 'compra_local',  // clasificador para Estado de Resultados
      }

      if (editId) {
        const { error } = await sb.from('disabi_gastos').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_gastos').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── COMPRA LOCAL / IMPORTACIÓN: eliminar ────────────────────────────────
    if (action === 'delete_compra') {
      const { id, tabla } = body
      if (tabla === 'gastos') {
        const { error } = await sb.from('disabi_gastos').delete().eq('id', id)
        if (error) throw error
      } else {
        // Si la importación estaba Recibida → revertir stock antes de eliminar
        const { data: compraAElim } = await sb.from('disabi_compras')
          .select('estado, numero').eq('id', id).single()

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

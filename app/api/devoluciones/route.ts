import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { today } from '@/lib/utils'
import { bloqueadoPorCierre } from '@/lib/cierre-server'
import { crearAsientoContable, partirIva, CUENTA } from '@/lib/contabilidad-server'

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
    // ── PROCESAR DEVOLUCIÓN ────────────────────────────────────────────────
    if (action === 'save_devolucion') {
      const {
        venta_id, fecha, tipo, motivo, items,
        genera_nota_credito, notas,
      } = body

      if (!venta_id || !items?.length)
        return NextResponse.json({ error: 'Venta e ítems requeridos' }, { status: 400 })

      const bloqueoDev = await bloqueadoPorCierre(fecha || today())
      if (bloqueoDev) return NextResponse.json({ error: bloqueoDev }, { status: 409 })

      // Leer la venta original
      const { data: venta } = await sb.from('disabi_ventas')
        .select('numero, nombre, monto, cobro, monto_neto, fecha').eq('id', venta_id).single()
      if (!venta)
        return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

      // La venta original tampoco puede estar en un mes ya cerrado
      const bloqueoVentaOrig = await bloqueadoPorCierre(venta.fecha ?? '')
      if (bloqueoVentaOrig) return NextResponse.json({ error: bloqueoVentaOrig }, { status: 409 })

      const montoDevuelto = items.reduce((a: number, i: { subtotal: number }) => a + i.subtotal, 0)

      // Número de devolución
      const { count: devCount } = await sb.from('disabi_devoluciones')
        .select('*', { count: 'exact', head: true })
      const numero = 'NDV-' + String((devCount ?? 0) + 1).padStart(4, '0')

      // Crear cabecera de devolución
      const { data: dev, error: devErr } = await sb.from('disabi_devoluciones').insert([{
        numero,
        venta_id,
        fecha:              fecha || today(),
        tipo,
        motivo:             motivo || null,
        monto_devuelto:     montoDevuelto,
        genera_nota_credito: !!genera_nota_credito,
        estado:             'Procesada',
        notas:              notas || null,
      }]).select().single()
      if (devErr) throw devErr

      // Crear ítems de devolución
      const itemsInsert = items.map((i: {
        venta_item_id?: string; producto_id?: string; lote_id?: string
        descripcion: string; cantidad: number; precio_unitario: number; subtotal: number
      }) => ({
        devolucion_id:   dev.id,
        venta_item_id:   i.venta_item_id   || null,
        producto_id:     i.producto_id     || null,
        lote_id:         i.lote_id         || null,
        descripcion:     i.descripcion,
        cantidad:        i.cantidad,
        precio_unitario: i.precio_unitario,
        subtotal:        i.subtotal,
      }))
      const { error: itemErr } = await sb.from('disabi_devolucion_items').insert(itemsInsert)
      if (itemErr) throw itemErr

      // ── Reponer stock (Kardex) para cada ítem ──────────────────────────
      for (const item of items.filter((i: { producto_id?: string }) => i.producto_id)) {
        const { data: prod } = await sb.from('disabi_productos')
          .select('stock_actual').eq('id', item.producto_id).single()
        if (prod) {
          const nuevoStock = (prod.stock_actual || 0) + item.cantidad
          await sb.from('disabi_productos')
            .update({ stock_actual: nuevoStock }).eq('id', item.producto_id)
          await sb.from('disabi_movimientos_inv').insert([{
            producto_id:   item.producto_id,
            tipo:          'Entrada',
            cantidad:      item.cantidad,
            stock_antes:   prod.stock_actual || 0,
            stock_despues: nuevoStock,
            referencia:    numero,
            motivo:        `Devolución de venta ${venta.numero ?? venta_id} — ${motivo || 'sin motivo'}`,
            fecha:         fecha || today(),
          }])
        }
        // Si viene con lote, reponer también en el lote
        if (item.lote_id) {
          const { data: lote } = await sb.from('disabi_lotes')
            .select('cantidad_actual').eq('id', item.lote_id).single()
          if (lote) {
            await sb.from('disabi_lotes')
              .update({
                cantidad_actual: (lote.cantidad_actual || 0) + item.cantidad,
                activo: true,
              })
              .eq('id', item.lote_id)
          }
        }
      }

      // ── Generar nota de crédito en CxC si aplica ───────────────────────
      // Corregido: usaba columnas que ya no existen (saldo, monto, numero,
      // fecha_emision, referencia) — fallaba en silencio. Ahora usa las columnas
      // reales (monto_total/monto_pendiente/monto_pagado, fecha_venta, notas) y
      // busca primero la CxC vinculada exactamente a esta venta por venta_id.
      let cxcId: string | null = null
      if (genera_nota_credito) {
        const { data: cxcDeLaVenta } = await sb.from('disabi_cxc')
          .select('id, monto_pendiente, monto_pagado')
          .eq('venta_id', venta_id)
          .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
          .maybeSingle()

        let cxcExist = cxcDeLaVenta
        if (!cxcExist) {
          // Sin CxC vinculada por venta_id (venta anterior a este fix) — match legacy
          const { data: cxcsPendientes } = await sb.from('disabi_cxc')
            .select('id, monto_pendiente, monto_pagado')
            .ilike('cliente', venta.nombre)
            .is('venta_id', null)
            .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
            .order('fecha_venta', { ascending: true })
          const cxcExacta = cxcsPendientes?.find(c => Math.abs(c.monto_pendiente - montoDevuelto) < 0.02)
          cxcExist = cxcExacta ?? cxcsPendientes?.[0] ?? null
        }

        if (cxcExist) {
          // Abonar (reducir) la CxC pendiente de esta venta
          const nuevoPendiente = Math.max(0, parseFloat(((cxcExist.monto_pendiente ?? 0) - montoDevuelto).toFixed(2)))
          const nuevoPagado    = parseFloat(((cxcExist.monto_pagado ?? 0) + montoDevuelto).toFixed(2))
          const nuevoEstado    = nuevoPendiente <= 0 ? 'Pagado' : 'Parcial'
          await sb.from('disabi_cxc')
            .update({ monto_pendiente: nuevoPendiente, monto_pagado: nuevoPagado, estado: nuevoEstado })
            .eq('id', cxcExist.id)
          await sb.from('disabi_cxc_abonos').insert([{
            cxc_id: cxcExist.id,
            monto:  montoDevuelto,
            fecha:  fecha || today(),
            notas:  `Nota de crédito — Devolución ${numero}`,
          }])
          cxcId = cxcExist.id
        } else {
          // No hay CxC pendiente: crear NC a favor del cliente para futura compensación
          const { data: newCxc } = await sb.from('disabi_cxc').insert([{
            cliente:         venta.nombre,
            monto_total:     montoDevuelto,
            monto_pagado:    0,
            monto_pendiente: montoDevuelto,
            estado:          'Pendiente',
            fecha_venta:     fecha || today(),
            venta_id,
            notas:           `Nota de crédito generada desde devolución de venta ${venta.numero ?? ''} (${numero})`,
          }]).select().single()
          if (newCxc) cxcId = newCxc.id
        }

        // Actualizar cxc_id en la devolución
        if (cxcId) {
          await sb.from('disabi_devoluciones').update({ cxc_id: cxcId }).eq('id', dev.id)
        }
      }

      // ══════════════════════════════════════════════════════════════════
      // CONTABILIDAD (Fase 2) — solo se postea si la devolución generó nota
      // de crédito (cxcId set): es el único caso en que hay un movimiento de
      // dinero/deuda real con el cliente. Una devolución sin nota de crédito
      // (ej. cambio de producto por otro de igual valor) no mueve cuentas.
      // Se revierte venta e IVA débito fiscal por el monto devuelto, contra
      // la CxC del cliente (ya sea que se haya reducido una existente o
      // creado una nueva a su favor — en ambos casos disabi_cxc es donde
      // vive esa cuenta con el cliente).
      // ══════════════════════════════════════════════════════════════════
      if (cxcId) {
        const { neto, iva } = partirIva(montoDevuelto)
        await crearAsientoContable(sb, {
          fecha: fecha || today(),
          concepto: `Devolución ${numero} — venta ${venta.numero ?? venta_id} — ${venta.nombre}`,
          origenTabla: 'disabi_devoluciones',
          origenId: dev.id,
          lineas: [
            { cuenta: CUENTA.DEVOLUCIONES_VENTAS, debe: neto, descripcion: 'Devolución sobre ventas' },
            { cuenta: CUENTA.IVA_DEBITO_FISCAL,    debe: iva,  descripcion: 'Reversa de IVA débito fiscal' },
            { cuenta: CUENTA.CXC_CLIENTES,         haber: montoDevuelto, descripcion: 'Nota de crédito a favor del cliente' },
          ],
          creadoPor: user.id,
        })
      }

      // ── Actualizar estado de la venta original ─────────────────────────
      const esTotal = tipo === 'total' || Math.abs(montoDevuelto - venta.monto) < 0.01
      await sb.from('disabi_ventas').update({
        devolucion_estado: esTotal ? 'Devuelta' : 'Parcialmente Devuelta',
      }).eq('id', venta_id)

      return NextResponse.json({
        ok: true,
        id: dev.id,
        numero,
        cxc_id: cxcId,
        tipo: esTotal ? 'total' : 'parcial',
      })
    }

    // ── ANULAR DEVOLUCIÓN (reversa) ────────────────────────────────────────
    if (action === 'anular_devolucion') {
      const { id } = body
      const { data: devExist } = await sb.from('disabi_devoluciones').select('fecha').eq('id', id).single()
      const bloqueoAnular = await bloqueadoPorCierre(devExist?.fecha ?? '')
      if (bloqueoAnular) return NextResponse.json({ error: bloqueoAnular }, { status: 409 })

      // Solo cambiar estado — las reversas contables son complejas, mejor crear un movimiento nuevo
      const { error } = await sb.from('disabi_devoluciones').update({ estado: 'Anulada' }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/devoluciones]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

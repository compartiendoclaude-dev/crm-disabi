import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(60)

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb     = await createClient()
    const url    = new URL(req.url)
    const nombre = url.searchParams.get('nombre')
    const desde  = url.searchParams.get('desde') ?? ''
    const hasta  = url.searchParams.get('hasta') ?? ''

    if (!nombre) return NextResponse.json({ error: 'nombre requerido' }, { status: 400 })

    // Cargar todo en paralelo
    const [
      { data: ventas },
      { data: cotizaciones },
      { data: cxcRows },
      { data: devoluciones },
    ] = await Promise.all([
      // Ventas del cliente (por nombre — sistema legacy)
      (() => {
        let q = sb.from('disabi_ventas')
          .select('id, numero, fecha, monto, monto_neto, cobro, metodo_pago, canal, items:disabi_venta_items(descripcion, cantidad, precio_unitario, subtotal)')
          .ilike('nombre', nombre)
          .neq('cobro', 'Borrador')
          .order('fecha', { ascending: false })
        if (desde) q = q.gte('fecha', desde)
        if (hasta) q = q.lte('fecha', hasta)
        return q
      })(),

      // PP (créditos) del cliente
      (() => {
        let q = sb.from('disabi_cotizaciones')
          .select('id, numero, fecha_emision, fecha_entrega, total, estado, dias_credito, metodo_pago')
          .ilike('cliente', nombre)
          .eq('tipo', 'Pendiente de Pago')
          .order('fecha_emision', { ascending: false })
        if (desde) q = q.gte('fecha_emision', desde)
        if (hasta) q = q.lte('fecha_emision', hasta)
        return q
      })(),

      // CxC del cliente con abonos
      sb.from('disabi_cxc')
        .select('id, numero, fecha_emision, fecha_vence, monto, saldo, estado, referencia, abonos:disabi_cxc_abonos(*)')
        .ilike('cliente', nombre)
        .order('fecha_emision', { ascending: false }),

      // Devoluciones del cliente
      (() => {
        let q = sb.from('disabi_devoluciones')
          .select('id, numero, fecha, tipo, monto_devuelto, estado, motivo, venta:disabi_ventas(numero, nombre)')
          .eq('estado', 'Procesada')
          .order('fecha', { ascending: false })
        if (desde) q = q.gte('fecha', desde)
        if (hasta) q = q.lte('fecha', hasta)
        return q
      })(),
    ])

    const vts  = ventas ?? []
    const pps  = cotizaciones ?? []
    const cxcs = cxcRows ?? []
    const devs = (devoluciones ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d: any) => (d.venta?.nombre ?? '').toLowerCase() === nombre.toLowerCase()
    )

    // ── Calcular resumen de cuenta ────────────────────────────────────────────
    const totalComprado    = vts.reduce((a, v) => a + (v.monto ?? 0), 0)
    const totalPagado      = vts.filter(v => v.cobro === 'Cobrado').reduce((a, v) => a + (v.monto ?? 0), 0)
    const totalCredito     = vts.filter(v => v.cobro === 'Pendiente').reduce((a, v) => a + (v.monto ?? 0), 0)
    const saldoPendiente   = cxcs.filter(c => c.estado !== 'Pagado').reduce((a, c) => a + (c.saldo ?? 0), 0)
    const totalDevuelto    = devs.reduce((a, d) => a + (d.monto_devuelto ?? 0), 0)
    const cxcVencidas      = cxcs.filter(c => c.estado === 'Vencido')
    const montoVencido     = cxcVencidas.reduce((a, c) => a + (c.saldo ?? 0), 0)

    // ── Construir línea de tiempo unificada ──────────────────────────────────
    type LineaTiempo = {
      fecha: string
      tipo: 'venta' | 'abono' | 'devolucion' | 'cxc'
      descripcion: string
      cargo: number      // lo que se le cobra al cliente
      abono: number      // lo que paga el cliente
      saldo_movimiento: number
      referencia?: string
      detalle?: unknown
    }

    const lineas: LineaTiempo[] = []

    // Ventas → cargo
    for (const v of vts) {
      lineas.push({
        fecha:       v.fecha,
        tipo:        'venta',
        descripcion: `Venta ${v.numero ?? v.id.slice(0, 8)}`,
        cargo:       v.cobro === 'Cobrado' || v.cobro === 'Liquidacion_Pendiente' ? 0 : v.monto,
        abono:       v.cobro === 'Cobrado' || v.cobro === 'Liquidacion_Pendiente' ? v.monto : 0,
        saldo_movimiento: v.monto,
        referencia:  v.numero,
        detalle:     { items: v.items, cobro: v.cobro, metodo: v.metodo_pago },
      })
    }

    // Abonos CxC → abono
    for (const cxc of cxcs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const ab of ((cxc as any).abonos ?? [])) {
        lineas.push({
          fecha:       ab.fecha,
          tipo:        'abono',
          descripcion: `Abono a ${cxc.numero ?? 'CxC'}`,
          cargo:       0,
          abono:       ab.monto,
          saldo_movimiento: ab.monto,
          referencia:  cxc.numero,
          detalle:     { notas: ab.notas, cxc_id: cxc.id },
        })
      }
    }

    // Devoluciones → nota de crédito
    for (const d of devs) {
      lineas.push({
        fecha:       d.fecha,
        tipo:        'devolucion',
        descripcion: `Devolución ${d.numero ?? d.id.slice(0, 8)} — ${d.motivo ?? ''}`,
        cargo:       0,
        abono:       d.monto_devuelto,
        saldo_movimiento: d.monto_devuelto,
        referencia:  d.numero,
        detalle:     { tipo: d.tipo, motivo: d.motivo },
      })
    }

    // Ordenar cronológico
    lineas.sort((a, b) => a.fecha.localeCompare(b.fecha))

    // Calcular saldo acumulado
    let saldoAcum = 0
    const lineasConSaldo = lineas.map(l => {
      saldoAcum += (l.cargo - l.abono)
      return { ...l, saldo_acumulado: saldoAcum }
    })

    return NextResponse.json({
      ok: true,
      cliente: nombre,
      resumen: {
        totalComprado,
        totalPagado,
        totalCredito,
        saldoPendiente,
        totalDevuelto,
        montoVencido,
        numVentas:     vts.length,
        numCxc:        cxcs.length,
        numVencidas:   cxcVencidas.length,
      },
      cxcs,
      pps,
      lineas: lineasConSaldo.reverse(), // más reciente primero
    })
  } catch (e: unknown) {
    console.error('[api/clientes/estado-cuenta]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { today } from '@/lib/utils'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(60)

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb  = await createClient()
    const url = new URL(req.url)
    const mes = url.searchParams.get('mes') ?? new Date().toISOString().slice(0, 7)

    const mesInicio = mes + '-01'
    const mesFin    = mes + '-31'

    const [
      { data: movBanco },
      { data: ventasCobradas },
      { data: cxcAbonos },
      { data: cppPagos },
      { data: gastos },
    ] = await Promise.all([
      sb.from('disabi_movimientos_banco')
        .select('*')
        .gte('fecha', mesInicio).lte('fecha', mesFin)
        .order('fecha', { ascending: false }),

      // Cobros del ERP del período — ventas cobradas en efectivo/transferencia
      sb.from('disabi_ventas')
        .select('id, numero, nombre, fecha, monto, monto_neto, metodo_pago, cobro')
        .gte('fecha', mesInicio).lte('fecha', mesFin)
        .in('cobro', ['Cobrado', 'Liquidacion_Pendiente']),

      // Abonos a CxC del período
      sb.from('disabi_cxc_abonos')
        .select('id, cxc_id, monto, fecha, notas, cxc:disabi_cxc(cliente, numero)')
        .gte('fecha', mesInicio).lte('fecha', mesFin),

      // Pagos a CPP del período (egresos)
      sb.from('disabi_cpp_pagos')
        .select('id, cpp_id, monto, fecha, notas, cpp:disabi_cpp(proveedor, numero)')
        .gte('fecha', mesInicio).lte('fecha', mesFin),

      // Gastos del período (egresos)
      sb.from('disabi_gastos')
        .select('id, descripcion, monto, fecha, categoria, tipo_egreso')
        .gte('fecha', mesInicio).lte('fecha', mesFin),
    ])

    const banco   = movBanco ?? []
    const ventas  = ventasCobradas ?? []
    const abonos  = cxcAbonos ?? []
    const pagos   = cppPagos ?? []
    const gtos    = gastos ?? []

    // ── KPIs banco
    const creditosBanco  = banco.filter(m => m.tipo === 'credito')
    const debitosBanco   = banco.filter(m => m.tipo === 'debito')
    const conciliados    = banco.filter(m => m.conciliado)
    const sinConciliar   = banco.filter(m => !m.conciliado)

    const kpis = {
      totalMovimientos:  banco.length,
      totalCreditos:     creditosBanco.reduce((a, m) => a + m.monto, 0),
      totalDebitos:      debitosBanco.reduce((a, m) => a + m.monto, 0),
      conciliados:       conciliados.length,
      sinConciliar:      sinConciliar.length,
      pctConciliado:     banco.length > 0 ? Math.round(conciliados.length / banco.length * 100) : 0,
      // ERP: cobros del período
      cobrosERP:         ventas.reduce((a, v) => a + v.monto, 0),
      abonosERP:         abonos.reduce((a, a2) => a + a2.monto, 0),
      pagosERP:          pagos.reduce((a, p) => a + p.monto, 0),
      gastosERP:         gtos.reduce((a, g) => a + g.monto, 0),
    }

    // ── Candidatos para conciliación automática
    // Ingresos ERP sin conciliar (efectivo/transferencia = bancario)
    const ingresosERP = [
      ...ventas
        .filter(v => v.metodo_pago === 'Transferencia' || v.metodo_pago === 'Efectivo')
        .map(v => ({
          id: v.id, tipo_match: 'venta' as const,
          fecha: v.fecha, descripcion: `Venta ${v.numero ?? v.id.slice(0,8)} — ${v.nombre}`,
          monto: v.monto, referencia: v.numero,
        })),
      ...abonos.map(a => ({
        id: a.id, tipo_match: 'cxc_abono' as const,
        fecha: a.fecha,
        descripcion: `Abono CxC — ${(a as { cxc?: { cliente?: string; numero?: string } }).cxc?.cliente ?? ''}`,
        monto: a.monto, referencia: (a as { cxc?: { cliente?: string; numero?: string } }).cxc?.numero,
      })),
    ]

    const egresosERP = [
      ...pagos.map(p => ({
        id: p.id, tipo_match: 'cpp_pago' as const,
        fecha: p.fecha,
        descripcion: `Pago CPP — ${(p as { cpp?: { proveedor?: string; numero?: string } }).cpp?.proveedor ?? ''}`,
        monto: p.monto, referencia: (p as { cpp?: { proveedor?: string; numero?: string } }).cpp?.numero,
      })),
      ...gtos.map(g => ({
        id: g.id, tipo_match: 'gasto' as const,
        fecha: g.fecha, descripcion: g.descripcion,
        monto: g.monto, referencia: g.categoria,
      })),
    ]

    return NextResponse.json({
      ok: true, mes,
      movimientos: banco,
      ingresosERP,
      egresosERP,
      kpis,
    })
  } catch (e: unknown) {
    console.error('[api/conciliacion GET]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb   = await createClient()
    const body = await req.json()
    const { action } = body

    // ── Importar movimientos bancarios (CSV parseado en el cliente) ────────────
    if (action === 'import_movimientos') {
      const { movimientos, cuenta } = body as {
        movimientos: {
          fecha: string; descripcion: string; referencia?: string
          tipo: 'credito' | 'debito'; monto: number; saldo_banco?: number
        }[]
        cuenta: string
      }

      if (!movimientos?.length)
        return NextResponse.json({ error: 'Sin movimientos' }, { status: 400 })

      const rows = movimientos.map(m => ({
        fecha:       m.fecha,
        descripcion: m.descripcion,
        referencia:  m.referencia || null,
        tipo:        m.tipo,
        monto:       Math.abs(m.monto),
        saldo_banco: m.saldo_banco ?? null,
        cuenta:      cuenta || 'Principal',
        conciliado:  false,
      }))

      const { data, error } = await sb
        .from('disabi_movimientos_banco')
        .insert(rows)
        .select('id')

      if (error) throw error
      return NextResponse.json({ ok: true, insertados: data?.length ?? rows.length })
    }

    // ── Conciliar manualmente un movimiento con una referencia ERP ────────────
    if (action === 'conciliar') {
      const { mov_id, tipo_match, referencia_erp, notas } = body
      const { error } = await sb.from('disabi_movimientos_banco').update({
        conciliado:     true,
        tipo_match:     tipo_match || 'manual',
        referencia_erp: referencia_erp || null,
        notas:          notas || null,
      }).eq('id', mov_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Marcar conciliado/no conciliado toggle ────────────────────────────────
    if (action === 'toggle_conciliado') {
      const { mov_id, conciliado } = body
      const { error } = await sb.from('disabi_movimientos_banco')
        .update({ conciliado, tipo_match: conciliado ? 'manual' : null })
        .eq('id', mov_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Agregar movimiento manual ─────────────────────────────────────────────
    if (action === 'add_movimiento') {
      const { fecha, descripcion, referencia, tipo, monto, cuenta, notas } = body
      const { error } = await sb.from('disabi_movimientos_banco').insert([{
        fecha: fecha || today(),
        descripcion, referencia: referencia || null,
        tipo, monto: Math.abs(monto),
        cuenta: cuenta || 'Principal',
        conciliado: false,
        notas: notas || null,
      }])
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Eliminar movimiento ───────────────────────────────────────────────────
    if (action === 'delete_movimiento') {
      const { id } = body
      const { error } = await sb.from('disabi_movimientos_banco').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/conciliacion POST]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

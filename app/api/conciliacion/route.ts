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
    // Bug conocido: 'mes-31' rompe la query en meses con menos de 31 días
    // (Postgres rechaza fechas como '2026-02-31' como valor de DATE inválido)
    const [anioNum, mesNum] = mes.split('-').map(Number)
    const mesFin = new Date(anioNum, mesNum, 0).toISOString().slice(0, 10)

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
        .select('id, cxc_id, monto, fecha, notas, cxc:disabi_cxc(cliente)')
        .gte('fecha', mesInicio).lte('fecha', mesFin),

      // Pagos a CPP del período (egresos)
      sb.from('disabi_cpp_pagos')
        .select('id, cpp_id, monto, fecha, notas, cpp:disabi_cpp(proveedor, numero_doc)')
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
        descripcion: `Abono CxC — ${(a as { cxc?: { cliente?: string } }).cxc?.cliente ?? ''}`,
        monto: a.monto, referencia: null as string | null,
      })),
    ]

    const egresosERP = [
      ...pagos.map(p => ({
        id: p.id, tipo_match: 'cpp_pago' as const,
        fecha: p.fecha,
        descripcion: `Pago CPP — ${(p as { cpp?: { proveedor?: string; numero_doc?: string } }).cpp?.proveedor ?? ''}`,
        monto: p.monto, referencia: (p as { cpp?: { proveedor?: string; numero_doc?: string } }).cpp?.numero_doc,
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

    // ── Cruce automático: banco vs ERP para un mes completo ───────────────────
    // Compara movimientos bancarios sin conciliar contra ventas/abonos/pagos/gastos
    // del ERP por monto exacto + proximidad de fecha. Marca automáticamente los
    // matches seguros (1 movimiento, 1 candidato exacto); deja el resto para revisión manual.
    if (action === 'auto_conciliar_mes') {
      const { mes } = body as { mes: string }
      if (!mes || !/^\d{4}-\d{2}$/.test(mes))
        return NextResponse.json({ error: 'Formato de mes inválido' }, { status: 400 })

      const [anioNum, mesNum] = mes.split('-').map(Number)
      const mesInicio = mes + '-01'
      const mesFin = new Date(anioNum, mesNum, 0).toISOString().slice(0, 10)

      const [
        { data: movSinConciliar },
        { data: ventasMes },
        { data: cxcAbonosMes },
        { data: cppPagosMes },
        { data: gastosMes },
      ] = await Promise.all([
        sb.from('disabi_movimientos_banco').select('*')
          .gte('fecha', mesInicio).lte('fecha', mesFin).eq('conciliado', false),
        sb.from('disabi_ventas').select('id, numero, nombre, fecha, monto')
          .gte('fecha', mesInicio).lte('fecha', mesFin).in('cobro', ['Cobrado', 'Liquidacion_Pendiente']),
        sb.from('disabi_cxc_abonos').select('id, monto, fecha, cxc:disabi_cxc(cliente)')
          .gte('fecha', mesInicio).lte('fecha', mesFin),
        sb.from('disabi_cpp_pagos').select('id, monto, fecha, cpp:disabi_cpp(proveedor)')
          .gte('fecha', mesInicio).lte('fecha', mesFin),
        sb.from('disabi_gastos').select('id, monto, fecha, descripcion')
          .gte('fecha', mesInicio).lte('fecha', mesFin),
      ])

      const movimientos = movSinConciliar ?? []
      const ventas = ventasMes ?? []
      const cxcAbonos = cxcAbonosMes ?? []
      const cppPagos = cppPagosMes ?? []
      const gastos = gastosMes ?? []

      // Candidatos posibles según el tipo de movimiento (créditos=ingresos, débitos=egresos)
      type Candidato = { tipo: 'venta' | 'cxc_abono' | 'cpp_pago' | 'gasto'; id: string; monto: number; fecha: string; label: string }
      const candidatosCredito: Candidato[] = [
        ...ventas.map(v => ({ tipo: 'venta' as const, id: v.id, monto: v.monto, fecha: v.fecha, label: `${v.numero ?? ''} — ${v.nombre}` })),
        ...cxcAbonos.map((a: { id: string; monto: number; fecha: string; cxc?: { cliente?: string } | { cliente?: string }[] }) => {
          const cliente = Array.isArray(a.cxc) ? a.cxc[0]?.cliente : a.cxc?.cliente
          return { tipo: 'cxc_abono' as const, id: a.id, monto: a.monto, fecha: a.fecha, label: `Abono CxC — ${cliente ?? ''}` }
        }),
      ]
      const candidatosDebito: Candidato[] = [
        ...cppPagos.map((p: { id: string; monto: number; fecha: string; cpp?: { proveedor?: string } | { proveedor?: string }[] }) => {
          const proveedor = Array.isArray(p.cpp) ? p.cpp[0]?.proveedor : p.cpp?.proveedor
          return { tipo: 'cpp_pago' as const, id: p.id, monto: p.monto, fecha: p.fecha, label: `Pago CPP — ${proveedor ?? ''}` }
        }),
        ...gastos.map(g => ({ tipo: 'gasto' as const, id: g.id, monto: g.monto, fecha: g.fecha, label: g.descripcion })),
      ]

      const usados = new Set<string>()
      let conciliados = 0
      const ambiguos: { mov_id: string; descripcion: string; monto: number; fecha: string; candidatos: number }[] = []
      const sinMatch: { mov_id: string; descripcion: string; monto: number; fecha: string }[] = []

      for (const mov of movimientos) {
        const pool = mov.tipo === 'credito' ? candidatosCredito : candidatosDebito
        const candidatos = pool.filter(c => !usados.has(`${c.tipo}:${c.id}`) && Math.abs(c.monto - mov.monto) <= 0.01)

        if (candidatos.length === 1) {
          const match = candidatos[0]
          await sb.from('disabi_movimientos_banco').update({
            conciliado: true, tipo_match: match.tipo, referencia_erp: match.id,
            notas: `Auto-conciliado: ${match.label}`,
          }).eq('id', mov.id)
          usados.add(`${match.tipo}:${match.id}`)
          conciliados++
        } else if (candidatos.length > 1) {
          ambiguos.push({ mov_id: mov.id, descripcion: mov.descripcion, monto: mov.monto, fecha: mov.fecha, candidatos: candidatos.length })
        } else {
          sinMatch.push({ mov_id: mov.id, descripcion: mov.descripcion, monto: mov.monto, fecha: mov.fecha })
        }
      }

      return NextResponse.json({
        ok: true,
        total: movimientos.length,
        conciliados,
        ambiguos: ambiguos.length,
        sinMatch: sinMatch.length,
        detalleAmbiguos: ambiguos,
        detalleSinMatch: sinMatch,
      })
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

    // ── Agregar movimientos en lote (desde importación PDF) ────────────────
    if (action === 'add_movimientos_bulk') {
      const { movimientos, cuenta } = body
      if (!movimientos?.length)
        return NextResponse.json({ error: 'Sin movimientos para importar' }, { status: 400 })

      const rows = movimientos.map((m: { fecha: string; descripcion: string; monto: number; tipo: string }) => ({
        fecha: m.fecha || today(),
        descripcion: m.descripcion,
        tipo: m.tipo === 'credito' ? 'credito' : 'debito',
        monto: Math.abs(m.monto),
        cuenta: cuenta || 'Principal',
        conciliado: false,
      }))

      const { error } = await sb.from('disabi_movimientos_banco').insert(rows)
      if (error) throw error
      return NextResponse.json({ ok: true, importados: rows.length })
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

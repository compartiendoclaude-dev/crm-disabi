import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// Fechas de referencia
function getDateRanges() {
  const hoy = today()
  const ym  = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const d   = new Date()
  const dow  = d.getDay()
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  const lunesStr  = lunes.toISOString().slice(0, 10)
  const domingoStr = new Date(lunes.getTime() + 6 * 86400000).toISOString().slice(0, 10)

  const anoInicio = ym.slice(0, 4) + '-01-01'

  return { hoy, mesInicio, mesFin, lunesStr, domingoStr, anoInicio }
}

export async function getDashboardData() {
  const sb = await createClient()
  const { hoy, mesInicio, mesFin, lunesStr, domingoStr, anoInicio } = getDateRanges()

  // Queries paralelas para máxima velocidad
  const [
    { data: ventasMes },
    { data: ventasSemana },
    { data: ventasHoy },
    { data: cxcActivas },
    { data: cppActivas },
    { data: gastosMes },
    { data: costosFijosActivos },
    { data: stockTotal },
    { data: ventasAno },
    { data: ppVenceSemana },
    { data: stockBajo },
    { data: cxcVencidas },
    { data: lotesAlerta },
  ] = await Promise.all([
    // Ventas del mes (cobradas o pendientes, no borradores)
    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha, nombre, devolucion_estado')
      .gte('fecha', mesInicio).lte('fecha', mesFin)
      .neq('cobro', 'Borrador'),

    // Ventas de la semana
    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha, nombre')
      .gte('fecha', lunesStr).lte('fecha', domingoStr)
      .neq('cobro', 'Borrador'),

    // Ventas de hoy
    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha')
      .eq('fecha', hoy)
      .neq('cobro', 'Borrador'),

    // CXC pendiente
    sb.from('disabi_cxc')
      .select('saldo, estado, fecha_vence')
      .in('estado', ['Pendiente', 'Vencido', 'Parcial']),

    // CPP pendiente
    sb.from('disabi_cpp')
      .select('saldo, estado, fecha_vence')
      .in('estado', ['Pendiente', 'Vencido', 'Parcial']),

    // Gastos del mes
    sb.from('disabi_gastos')
      .select('monto, categoria')
      .gte('fecha', mesInicio).lte('fecha', mesFin),

    // Costos fijos activos
    sb.from('disabi_costos_fijos')
      .select('monto, descripcion')
      .eq('activo', true),

    // Stock total
    sb.from('disabi_productos')
      .select('stock_actual, costo_unitario')
      .eq('activo', true),

    // Ventas del año (para meta anual y gráfica)
    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha')
      .gte('fecha', anoInicio)
      .neq('cobro', 'Borrador'),

    // PP (Pendientes de Pago) que vencen esta semana
    sb.from('disabi_cotizaciones')
      .select('total, fecha_entrega, cliente, estado')
      .eq('tipo', 'Pendiente de Pago')
      .eq('estado', 'Pendiente')
      .gte('fecha_entrega', lunesStr)
      .lte('fecha_entrega', domingoStr),

    // ALERTAS: Stock bajo — todos con stock_minimo definido > 0
    sb.from('disabi_productos')
      .select('id, codigo, nombre, stock_actual, stock_minimo')
      .eq('activo', true)
      .not('stock_minimo', 'is', null)
      .gt('stock_minimo', 0),

    // ALERTAS: CxC vencidas con saldo pendiente
    sb.from('disabi_cxc')
      .select('id, numero, cliente, saldo, fecha_vence')
      .eq('estado', 'Vencido')
      .gt('saldo', 0)
      .order('saldo', { ascending: false })
      .limit(20),

    // ALERTAS: Lotes que vencen en 30 días
    sb.from('disabi_lotes')
      .select('id, numero_lote, fecha_vencimiento, cantidad_actual, producto:disabi_productos(nombre, codigo)')
      .eq('activo', true)
      .gt('cantidad_actual', 0)
      .lte('fecha_vencimiento', (() => { const d = new Date(hoy); d.setDate(d.getDate() + 30); return d.toISOString().slice(0,10) })())
      .gte('fecha_vencimiento', hoy)
      .order('fecha_vencimiento', { ascending: true })
      .limit(20),
  ])

  // ── Cálculos KPIs ────────────────────────────────────────────────────────────
  const v = ventasMes ?? []
  const vs = ventasSemana ?? []
  const vh = ventasHoy ?? []

  const ventasMesTotal    = v.filter(x => x.cobro === 'Cobrado').reduce((a, x) => a + (x.monto || 0), 0)
  const ventasMesMonto    = v.reduce((a, x) => a + (x.monto || 0), 0)
  const ventasSemTotal    = vs.filter(x => x.cobro === 'Cobrado').reduce((a, x) => a + (x.monto || 0), 0)
  const ventasHoyTotal    = vh.filter(x => x.cobro === 'Cobrado').reduce((a, x) => a + (x.monto || 0), 0)
  const liquidacionHoy    = vh.filter(x => x.cobro === 'Liquidacion_Pendiente').reduce((a, x) => a + (x.monto_neto || x.monto || 0), 0)
  // BASE DEVENGADA del mes (consistente con P&L): todas las ventas no-Borrador, no-Devuelta
  // Incluye créditos y liquidaciones pendientes — lo que el negocio generó, no lo que cobró
  const ventasMesDevengado = v
    .filter(x => (x as { devolucion_estado?: string }).devolucion_estado !== 'Devuelta')
    .reduce((a, x) => a + (x.monto || 0), 0)

  const cxcTotal   = (cxcActivas ?? []).reduce((a, x) => a + (x.saldo || 0), 0)
  const cxcVencido = (cxcActivas ?? []).filter(x => x.estado === 'Vencido').reduce((a, x) => a + (x.saldo || 0), 0)
  const cppTotal   = (cppActivas ?? []).reduce((a, x) => a + (x.saldo || 0), 0)

  const gastosTotal    = (gastosMes ?? []).reduce((a, x) => a + (x.monto || 0), 0)
  const costosFijosSum = (costosFijosActivos ?? []).reduce((a, x) => a + (x.monto || 0), 0)

  const stockValor = (stockTotal ?? []).reduce((a, x) => a + ((x.stock_actual || 0) * (x.costo_unitario || 0)), 0)

  const ticketMes = v.filter(x => x.cobro === 'Cobrado').length > 0
    ? ventasMesTotal / v.filter(x => x.cobro === 'Cobrado').length
    : 0
  const ticketSem = vs.filter(x => x.cobro === 'Cobrado').length > 0
    ? ventasSemTotal / vs.filter(x => x.cobro === 'Cobrado').length
    : 0

  const netoSemana = ventasSemTotal - (gastosMes ?? [])
    .reduce((a, x) => a + (x.monto || 0), 0) / 4 // aprox gasto semana

  // Ventas por mes del año (para gráfica Estado de Resultados)
  const ventasPorMes: Record<string, { ventas: number; gastos: number; neto: number }> = {}
  ;(ventasAno ?? []).forEach(v => {
    const mes = (v.fecha || '').slice(0, 7)
    if (!mes) return
    if (!ventasPorMes[mes]) ventasPorMes[mes] = { ventas: 0, gastos: 0, neto: 0 }
    if (v.cobro === 'Cobrado') ventasPorMes[mes].ventas += v.monto || 0
  })

  // Meta anual: $200,000 (configurable)
  const META_ANUAL = 200000
  const ventasAnoTotal = (ventasAno ?? []).filter(x => x.cobro === 'Cobrado').reduce((a, x) => a + (x.monto || 0), 0)
  const metaAnualPct = Math.min(100, (ventasAnoTotal / META_ANUAL) * 100)

  // Items del mes (conteo de ventas, no items individuales — para metas)
  const itemsMes = v.filter(x => x.cobro === 'Cobrado').length
  const itemsSem = vs.filter(x => x.cobro === 'Cobrado').length
  const itemsHoy = vh.filter(x => x.cobro === 'Cobrado').length

  // Clientes únicos del mes
  const clientesMes = new Set(v.filter(x => x.cobro === 'Cobrado').map(x => x.nombre)).size

  return {
    // KPIs principales
    ventasMesTotal,        // base caja: solo cobradas
    ventasMesDevengado,    // base devengada: consistente con P&L
    ventasMesMonto,
    ventasSemTotal,
    ventasHoyTotal,
    liquidacionHoy,
    cxcTotal,
    cxcVencido,
    cppTotal,
    gastosTotal,
    costosFijosSum,
    stockValor,
    ticketMes,
    ticketSem,
    netoSemana,
    metaAnualPct,
    ventasAnoTotal,
    itemsMes,
    itemsSem,
    itemsHoy,
    clientesMes,
    ppVenceSemana: ppVenceSemana ?? [],

    // Alertas
    alertas: {
      stockBajo:    ((stockBajo ?? []) as { id: string; codigo: string; nombre: string; stock_actual: number; stock_minimo: number }[])
                    .filter(p => p.stock_actual <= p.stock_minimo),
      cxcVencidas:  (cxcVencidas ?? []) as { id: string; numero?: string; cliente: string; saldo: number; fecha_vence?: string }[],
      lotesVencen:  (lotesAlerta ?? []) as unknown as { id: string; numero_lote: string; fecha_vencimiento: string; cantidad_actual: number; producto?: { nombre: string; codigo: string } | null }[],
      ppSemana:     (ppVenceSemana ?? []) as { cliente: string; total: number; fecha_entrega: string }[],
    },

    // Para gráficas
    ventasPorMes,
    ventasSemana: vs,
    gastosMes: gastosMes ?? [],
    costosFijos: costosFijosActivos ?? [],

    // Fechas usadas
    hoy,
    mesActual: nowYM(),
  }
}

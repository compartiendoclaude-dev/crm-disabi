import { createClient } from '@/lib/supabase-server'
import { today, nowYM, estaVencida } from '@/lib/utils'

// Valida 'YYYY-MM' contra un rango razonable — evita que un query param
// manipulado dispare un Date() inválido o un rango absurdo.
function esYmValido(ym: string | undefined | null): ym is string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return false
  const mes = parseInt(ym.slice(5, 7))
  return mes >= 1 && mes <= 12
}

// Fechas de referencia. `ymParam` (YYYY-MM) selecciona el mes que se muestra
// en las secciones "del mes" del Resumen — si no se pasa o es inválido, cae
// al mes actual. "Hoy" y "esta semana" SIEMPRE son las reales (no dependen
// del mes seleccionado — no tendría sentido ver "hoy" de un mes pasado).
function getDateRanges(ymParam?: string) {
  const hoy = today()
  const ym  = esYmValido(ymParam) ? ymParam : nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const d   = new Date()
  const dow  = d.getDay()
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  const lunesStr  = lunes.toISOString().slice(0, 10)
  const domingoStr = new Date(lunes.getTime() + 6 * 86400000).toISOString().slice(0, 10)

  // Año de referencia para "Meta Anual": el año del mes seleccionado, no
  // siempre el año en curso — así al navegar a un mes de otro año, el
  // acumulado anual se recalcula sobre ese año.
  const anoInicio = ym.slice(0, 4) + '-01-01'

  return { hoy, ym, mesInicio, mesFin, lunesStr, domingoStr, anoInicio }
}

export async function getDashboardData(mesParam?: string) {
  const sb = await createClient()
  const { hoy, ym, mesInicio, mesFin, lunesStr, domingoStr, anoInicio } = getDateRanges(mesParam)
  const esMesActual = ym === nowYM()

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

    // CXC pendiente — columna real: monto_pendiente (no 'saldo')
    sb.from('disabi_cxc')
      .select('monto_pendiente, estado, fecha_vence')
      .in('estado', ['Pendiente', 'Vencido', 'Parcial']),

    // CPP pendiente — columna real: monto_pendiente (no 'saldo')
    sb.from('disabi_cpp')
      .select('monto_pendiente, estado, fecha_vence')
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

    // ALERTAS: CxC vencidas con saldo pendiente. El campo `estado` nunca pasa
    // a 'Vencido' en ningún flujo de escritura — se filtra por fecha, igual
    // que hacen las tablas de Finanzas al pintar la fila en rojo (ver
    // estaVencida en lib/utils.ts). Antes esto filtraba por estado='Vencido'
    // y por eso esta alerta nunca mostraba nada, sin importar qué tan vencido
    // estuviera un cliente.
    sb.from('disabi_cxc')
      .select('id, cliente, monto_pendiente, fecha_vence, estado')
      .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
      .gt('monto_pendiente', 0)
      .lt('fecha_vence', hoy)
      .order('fecha_vence', { ascending: true })
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

  const cxcTotal   = (cxcActivas ?? []).reduce((a, x) => a + (x.monto_pendiente || 0), 0)
  const cxcVencido = (cxcActivas ?? []).filter(x => estaVencida(x, hoy)).reduce((a, x) => a + (x.monto_pendiente || 0), 0)
  const cppTotal   = (cppActivas ?? []).reduce((a, x) => a + (x.monto_pendiente || 0), 0)
  // Mismo cálculo aplicado a CPP — comparte el mismo bug de fondo (estado
  // 'Vencido' nunca se escribe), se corrige igual mientras se revisa CPP aparte.
  const cppVencido = (cppActivas ?? []).filter(x => estaVencida(x, hoy)).reduce((a, x) => a + (x.monto_pendiente || 0), 0)

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

  // ── Indicadores financieros (Salud Financiera) ─────────────────────────────
  // Margen neto del mes, en base devengada (consistente con lo que el negocio
  // generó, no solo lo cobrado) — mismo criterio que ventasMesDevengado arriba.
  const margenNetoPct = ventasMesDevengado > 0
    ? ((ventasMesDevengado - gastosTotal - costosFijosSum) / ventasMesDevengado) * 100
    : 0

  // % de la cartera (CxC/CPP) que ya está vencida — indicador de riesgo de cobro/pago
  const pctCarteraVencida = cxcTotal > 0 ? (cxcVencido / cxcTotal) * 100 : 0
  const pctCppVencida     = cppTotal > 0 ? (cppVencido / cppTotal) * 100 : 0

  // Días de Cartera (DSO aproximado): CxC pendiente ÷ venta diaria promedio del
  // mes mostrado (devengada). Aproximación estándar — no sustituye un cálculo
  // formal sobre ventas a crédito únicamente, pero da la magnitud correcta.
  // Si el mes mostrado es el actual (en curso), se promedia sobre los días ya
  // transcurridos; si es un mes cerrado, sobre el total de días de ese mes.
  const diasEnMesSeleccionado = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).getDate()
  const diasParaPromedio = esMesActual ? new Date(hoy).getDate() : diasEnMesSeleccionado
  const ventaDiariaProm  = diasParaPromedio > 0 ? ventasMesDevengado / diasParaPromedio : 0
  const diasCarteraCxC   = ventaDiariaProm > 0 ? cxcTotal / ventaDiariaProm : 0

  // Cobertura de Costos Fijos: cuántas veces el efectivo cobrado en el mes
  // cubre los costos fijos del período (nómina, alquiler, etc.)
  const coberturaCostosFijos = costosFijosSum > 0 ? ventasMesTotal / costosFijosSum : 0

  // Posición neta de cartera: cuánto más nos deben (CxC) de lo que debemos (CPP)
  const posicionNetaCartera = cxcTotal - cppTotal

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
    cppVencido,
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

    // Indicadores financieros
    margenNetoPct,
    pctCarteraVencida,
    pctCppVencida,
    diasCarteraCxC,
    coberturaCostosFijos,
    posicionNetaCartera,

    // Alertas
    alertas: {
      stockBajo:    ((stockBajo ?? []) as { id: string; codigo: string; nombre: string; stock_actual: number; stock_minimo: number }[])
                    .filter(p => p.stock_actual <= p.stock_minimo),
      cxcVencidas:  (cxcVencidas ?? []) as { id: string; cliente: string; monto_pendiente: number; fecha_vence?: string; estado: string }[],
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
    mesActual: ym,          // mes seleccionado (por defecto, el actual)
    esMesActual,
  }
}

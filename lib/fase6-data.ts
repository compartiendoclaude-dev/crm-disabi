import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// ── Reportes ──────────────────────────────────────────────────────────────────
export async function getReportesData() {
  const sb  = await createClient()
  const hoy  = today()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const [
    { data: ventas },
    { data: gastos },
    { data: costosFijos },
    { data: cxc },
    { data: cpp },
    { data: productos },
    { data: movimientos },
    { data: clientes },
    { data: ppPendientes },
    { data: planillaMes },
    { data: comisionesMes },
  ] = await Promise.all([
    sb.from('disabi_ventas').select('*, items:disabi_venta_items(*, producto:disabi_productos(nombre, codigo))').order('fecha', { ascending: false }).limit(500),
    sb.from('disabi_gastos').select('*').order('fecha', { ascending: false }).limit(200),
    sb.from('disabi_costos_fijos').select('*').eq('activo', true),
    sb.from('disabi_cxc').select('*').order('fecha_vence'),
    sb.from('disabi_cpp').select('*').order('fecha_vence'),
    sb.from('disabi_productos').select('*').eq('activo', true),
    sb.from('disabi_movimientos_inv').select('*, producto:disabi_productos(nombre)').order('fecha', { ascending: false }).limit(200),
    sb.from('disabi_clientes').select('*').order('nombre'),
    sb.from('disabi_cotizaciones').select('*').eq('tipo', 'Pendiente de Pago').neq('estado', 'Pagado'),
    // Planilla y comisiones devengadas del mes — igual que Finanzas
    sb.from('disabi_planilla')
      .select('salario_bruto, costo_total_empresa, estado, tipo_pago')
      .eq('periodo', ym).neq('estado', 'Anulado'),
    sb.from('disabi_comision_registros')
      .select('comision_bruta, estado')
      .eq('periodo', ym).neq('estado', 'Bloqueado'),
  ])

  // ── Calcular los mismos agregados que Finanzas para consistencia ──────────
  const vm = ventas ?? []
  const gm = gastos ?? []
  const pm = planillaMes ?? []
  const com = comisionesMes ?? []
  const cf = costosFijos ?? []

  // Ingresos brutos devengados (igual que Finanzas — base devengada, no solo cobradas)
  // Excluir devoluciones totales igual que Finanzas
  const vmMes = vm.filter(v => v.fecha >= mesInicio && v.fecha <= mesFin && v.cobro !== 'Borrador')
  const vmMesActivas = vmMes.filter(v => v.devolucion_estado !== 'Devuelta')
  const ingresosBrutosMes = vmMesActivas.reduce((a, v) => a + (v.monto || 0), 0)
  const costoCanalMes     = vmMesActivas.reduce((a, v) =>
    a + (v.paquetera_costo || 0) + (v.paquetera_com_monto || 0) +
    (v.liq_iva_percibido || 0) + (v.liq_comision || 0) + (v.liq_iva_comision || 0), 0)
  const ingresoNetoMes    = ingresosBrutosMes - costoCanalMes

  // Desglose de gastos igual que Finanzas
  const gmMes = gm.filter(g => g.fecha >= mesInicio && g.fecha <= mesFin)
  const costoVentasMes     = gmMes.filter(g => g.tipo_egreso === 'compra_local' || g.tipo_compra === 'Local').reduce((a, g) => a + g.monto, 0)
  const gastosOperMes      = gmMes.filter(g => g.tipo_egreso === 'operativo' || (!g.tipo_egreso && g.tipo_compra !== 'Local')).reduce((a, g) => a + g.monto, 0)
  const planillaDevMes     = pm.reduce((a, p) => a + (p.costo_total_empresa || 0), 0)
  const comisionesDevMes   = com.reduce((a, c) => a + (c.comision_bruta || 0), 0)
  const cfActivoSum        = cf.filter(c => c.activo !== false).reduce((a, c) => a + c.monto, 0)

  const utilidadBrutaMes   = ingresoNetoMes - costoVentasMes
  const totalEgresosOpMes  = gastosOperMes + planillaDevMes + comisionesDevMes + cfActivoSum
  const utilidadOpMes      = utilidadBrutaMes - totalEgresosOpMes
  const margenBrutoMes     = ingresoNetoMes > 0 ? (utilidadBrutaMes / ingresoNetoMes * 100) : 0
  const margenNetoMes      = ingresoNetoMes > 0 ? (utilidadOpMes    / ingresoNetoMes * 100) : 0

  return {
    ventas:        vm,
    gastos:        gm,
    costosFijos:   cf,
    cxc:           cxc          ?? [],
    cpp:           cpp          ?? [],
    productos:     productos    ?? [],
    movimientos:   movimientos  ?? [],
    clientes:      clientes     ?? [],
    ppPendientes:  ppPendientes ?? [],
    // Agregados financieros consistentes con Finanzas (base devengada)
    finMes: {
      ingresosBrutos:       ingresosBrutosMes,
      costoCanal:           costoCanalMes,
      ingresoNeto:          ingresoNetoMes,
      costoVentas:          costoVentasMes,
      utilidadBruta:        utilidadBrutaMes,
      gastosOperativos:     gastosOperMes,
      planillaDevengada:    planillaDevMes,
      comisionesDevengadas: comisionesDevMes,
      costosFijosSum:       cfActivoSum,
      totalEgresosOp:       totalEgresosOpMes,
      utilidadOperativa:    utilidadOpMes,
      margenBrutoPct:       margenBrutoMes,
      margenNetoPct:        margenNetoMes,
    },
    hoy, mesActual: ym, mesInicio, mesFin,
  }
}

// ── Proyecciones ──────────────────────────────────────────────────────────────
export async function getProyeccionesData() {
  const sb  = await createClient()
  const hoy  = today()

  // Últimos 30 días para base de proyección
  const ref30 = new Date(hoy); ref30.setDate(ref30.getDate() - 30)
  const ref30s = ref30.toISOString().slice(0, 10)

  // Últimos 6 meses para tendencia
  const hace6m = new Date(hoy); hace6m.setMonth(hace6m.getMonth() - 5); hace6m.setDate(1)
  const hace6ms = hace6m.toISOString().slice(0, 10)

  const [
    { data: ventas30 },
    { data: ventasMeses },
    { data: gastos30 },
    { data: costosFijos },
    { data: clientesNuevos30 },
    { data: cxcProxMes },
    { data: cppProxMes },
  ] = await Promise.all([
    sb.from('disabi_ventas').select('monto, fecha, cobro').gte('fecha', ref30s).lte('fecha', hoy).eq('cobro', 'Cobrado'),
    sb.from('disabi_ventas').select('monto, fecha, cobro').gte('fecha', hace6ms + '-01').eq('cobro', 'Cobrado'),
    sb.from('disabi_gastos').select('monto, fecha').gte('fecha', ref30s),
    sb.from('disabi_costos_fijos').select('monto').eq('activo', true),
    sb.from('disabi_clientes').select('id').gte('fecha_registro', ref30s),
    sb.from('disabi_cxc').select('saldo, fecha_vence').in('estado', ['Pendiente', 'Parcial', 'Vencido']),
    sb.from('disabi_cpp').select('saldo, fecha_vence').in('estado', ['Pendiente', 'Parcial']),
  ])

  const v30  = ventas30 ?? []
  const vm   = ventasMeses ?? []
  const gm30 = gastos30 ?? []
  const cf   = costosFijos ?? []

  // Ingresos diarios promedio
  const ingRef30  = v30.reduce((a, v) => a + v.monto, 0)
  const ingDiario = ingRef30 / 30

  // Ventas por mes (últimos 6 meses) para regresión lineal
  const last6: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoy); d.setMonth(d.getMonth() - i); d.setDate(1)
    last6.push(d.toISOString().slice(0, 7))
  }
  const ventasPorMes = last6.map(m =>
    vm.filter(v => (v.fecha ?? '').slice(0, 7) === m).reduce((a, v) => a + v.monto, 0)
  )

  // Regresión lineal simple
  const n    = ventasPorMes.length
  const xs   = ventasPorMes.map((_, i) => i)
  const sumX  = xs.reduce((a, x) => a + x, 0)
  const sumY  = ventasPorMes.reduce((a, y) => a + y, 0)
  const sumXY = xs.reduce((a, x, i) => a + x * ventasPorMes[i], 0)
  const sumX2 = xs.reduce((a, x) => a + x * x, 0)
  const slope = n > 1 ? (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) : 0
  const intercept = (sumY - slope * sumX) / n

  const cfSum = cf.reduce((a, c) => a + c.monto, 0)
  const gastosMes30 = gm30.reduce((a, g) => a + g.monto, 0)
  const gastosOpMes = gastosMes30 + cfSum

  // Proyección próximos 1/3/6 meses
  const proyVentas = (horizonte: number) =>
    Array.from({ length: horizonte }, (_, i) => Math.max(0, intercept + slope * (n + i)))

  // Flujo proyectado próximo mes
  const proxMesIni = new Date(hoy); proxMesIni.setMonth(proxMesIni.getMonth() + 1); proxMesIni.setDate(1)
  const proxMesFin = new Date(proxMesIni); proxMesFin.setMonth(proxMesFin.getMonth() + 1); proxMesFin.setDate(0)
  const proxIni = proxMesIni.toISOString().slice(0, 10)
  const proxFin = proxMesFin.toISOString().slice(0, 10)
  const cxcProx = (cxcProxMes ?? []).filter(x => x.fecha_vence >= proxIni && x.fecha_vence <= proxFin).reduce((a, x) => a + x.saldo, 0)
  const cppProx = (cppProxMes ?? []).filter(x => x.fecha_vence >= proxIni && x.fecha_vence <= proxFin).reduce((a, x) => a + x.saldo, 0)

  return {
    ventasPorMes, last6,
    slope, intercept,
    ingDiario, ingRef30,
    gastosMes30, cfSum, gastosOpMes,
    clientesNuevos30: (clientesNuevos30 ?? []).length,
    cxcProxMes: cxcProx,
    cppProxMes: cppProx,
    proyVentas,
    hoy,
  }
}

// ── Planilla ──────────────────────────────────────────────────────────────────
export async function getPlanillaData() {
  const sb  = await createClient()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const [
    { data: empleados },
    { data: planillaMes },
    { data: planillaHistorico },
    { data: comisiones },
  ] = await Promise.all([
    sb.from('disabi_empleados').select('*').order('nombre'),
    sb.from('disabi_planilla')
      .select('*, empleado:disabi_empleados(nombre, cargo)')
      .eq('periodo', ym)
      .order('created_at'),
    sb.from('disabi_planilla')
      .select('periodo, salario_bruto, salario_neto, total_deducciones, costo_total_empresa, estado')
      .order('periodo', { ascending: false })
      .limit(60),
    sb.from('disabi_comision_registros')
      .select('*, empleado:disabi_empleados(nombre, cargo), lineas:disabi_comision_lineas(*)')
      .order('periodo', { ascending: false })
      .limit(100),
  ])

  const emp = empleados ?? []
  const pm  = planillaMes ?? []

  const kpis = {
    totalEmpleados:   emp.filter(e => e.activo !== false).length,
    planillaNetoMes:  pm.filter(p => p.estado !== 'Anulado').reduce((a, p) => a + (p.salario_neto ?? 0), 0),
    planillaBrutoMes: pm.filter(p => p.estado !== 'Anulado').reduce((a, p) => a + (p.salario_bruto ?? 0), 0),
    costoTotalMes:    pm.filter(p => p.estado !== 'Anulado').reduce((a, p) => a + (p.costo_total_empresa ?? 0), 0),
    totalDeducciones: pm.filter(p => p.estado !== 'Anulado').reduce((a, p) => a + (p.total_deducciones ?? 0), 0),
    pagados:   pm.filter(p => p.estado === 'Pagado').length,
    pendientes: pm.filter(p => p.estado === 'Pendiente').length,
  }

  return {
    empleados: emp,
    planillaMes: pm,
    planillaHistorico: planillaHistorico ?? [],
    comisiones: comisiones ?? [],
    kpis, mesActual: ym, mesInicio, mesFin,
  }
}

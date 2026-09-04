import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// ── Clientes ──────────────────────────────────────────────────────────────────
export async function getClientesData() {
  const sb  = await createClient()
  const hoy  = today()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)
  const hace30 = new Date(hoy); hace30.setDate(hace30.getDate() - 30)
  const hace60 = new Date(hoy); hace60.setDate(hace60.getDate() - 60)
  const hace30s = hace30.toISOString().slice(0, 10)
  const hace60s = hace60.toISOString().slice(0, 10)

  const [
    { data: clientes },
    { data: ventas },
    { data: cotizaciones },
    { data: cxcActivas },
  ] = await Promise.all([
    sb.from('disabi_clientes').select('id, nombre, contacto, email, telefono, sector, direccion, pais, limite_credito, notas, fecha_registro, created_at').order('nombre'),
    sb.from('disabi_ventas').select('nombre, fecha, cobro, monto').neq('cobro', 'Borrador'),
    sb.from('disabi_cotizaciones').select('cliente, tipo, estado').eq('tipo', 'Cotizacion'),
    sb.from('disabi_cxc').select('cliente').in('estado', ['Pendiente', 'Vencido', 'Parcial']),
  ])

  const cls  = clientes ?? []
  const vts  = ventas ?? []
  const cots = cotizaciones ?? []

  const ultimaVentaMap: Record<string, string> = {}
  vts.forEach(v => {
    const k = (v.nombre ?? '').toLowerCase().trim()
    if (!ultimaVentaMap[k] || v.fecha > ultimaVentaMap[k]) ultimaVentaMap[k] = v.fecha
  })

  const conCredito = new Set((cxcActivas ?? []).map(c => (c.cliente ?? '').toLowerCase().trim()))

  const clientesEnriquecidos = cls.map(c => {
    const k = c.nombre.toLowerCase().trim()
    return {
      ...c,
      ultima_venta:      ultimaVentaMap[k] ?? null,
      num_ventas:        vts.filter(v => (v.nombre ?? '').toLowerCase().trim() === k).length,
      num_cotizaciones:  cots.filter(x => (x.cliente ?? '').toLowerCase().trim() === k).length,
      credito_activo:    conCredito.has(k),
    }
  })

  const kpis = {
    total:       cls.length,
    conVentas:   clientesEnriquecidos.filter(c => c.num_ventas > 0).length,
    nuevosMes:   cls.filter(c => (c.fecha_registro ?? '') >= mesInicio && (c.fecha_registro ?? '') <= mesFin).length,
    conCredito:  conCredito.size,
    activos30:   clientesEnriquecidos.filter(c => c.ultima_venta && c.ultima_venta >= hace30s).length,
    inactivos60: clientesEnriquecidos.filter(c => !c.ultima_venta || c.ultima_venta < hace60s).length,
    riesgo:      clientesEnriquecidos.filter(c => c.ultima_venta && c.ultima_venta >= hace60s && c.ultima_venta < hace30s).length,
  }

  return { clientes: clientesEnriquecidos, kpis }
}

// ── Finanzas ──────────────────────────────────────────────────────────────────
// Base contable: DEVENGADA (NIIF para PYMES, Sección 2)
// - Ingresos: cuando se transfiere el control del bien (fecha de venta), no cuando se cobra
// - Egresos: cuando se incurre en la obligación, no cuando se paga
// - Excepción: ventas Borrador NO se devengan (aún no hay transferencia de control)
export async function getFinanzasData(mesSel?: string) {
  const sb  = await createClient()
  const hoy  = today()
  const ym   = mesSel || nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)
  const anoInicio = ym.slice(0, 4) + '-01-01'
  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30)
  const en30s = en30.toISOString().slice(0, 10)

  const [
    { data: ventasMes },
    { data: ventasAno },
    { data: gastosMes },
    { data: costosFijos },
    { data: cxcAll },
    { data: cxcAbonos },
    { data: cppAll },
    { data: cppPagos },
    { data: ppProximos },
    { data: cppProximos },
    { data: planillaMes },
    { data: comisionesMes },
  ] = await Promise.all([
    // BASE DEVENGADA: todas las ventas del mes excepto Borrador y Devueltas totalmente
    // (Cobrado + Pendiente/crédito + Liquidacion_Pendiente = todas devengadas)
    // Devoluciones totales se excluyen: el ingreso se revierte cuando se devuelve
    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha, paquetera_costo, paquetera_com_monto, liq_iva_percibido, liq_comision, liq_iva_comision, devolucion_estado')
      .gte('fecha', mesInicio).lte('fecha', mesFin)
      .neq('cobro', 'Borrador'),

    sb.from('disabi_ventas')
      .select('monto, monto_neto, cobro, fecha, paquetera_costo, paquetera_com_monto, devolucion_estado')
      .gte('fecha', anoInicio)
      .neq('cobro', 'Borrador'),

    // Todos los gastos del mes (incluye compras locales, planilla, comisiones registrados como gastos)
    sb.from('disabi_gastos')
      .select('monto, categoria, tipo_egreso, descripcion, tipo_compra')
      .gte('fecha', mesInicio).lte('fecha', mesFin),

    sb.from('disabi_costos_fijos').select('*').order('monto', { ascending: false }),

    sb.from('disabi_cxc').select('*').neq('estado', 'Pagado').order('fecha_vence', { ascending: true }),
    sb.from('disabi_cxc_abonos').select('*').order('fecha', { ascending: false }),
    sb.from('disabi_cpp').select('*').order('fecha_vence', { ascending: true }),
    sb.from('disabi_cpp_pagos').select('*').order('fecha', { ascending: false }),

    sb.from('disabi_cotizaciones').select('total, fecha_entrega, cliente')
      .eq('tipo', 'Pendiente de Pago').eq('estado', 'Pendiente')
      .lte('fecha_entrega', en30s).gte('fecha_entrega', hoy),

    sb.from('disabi_cpp').select('saldo, fecha_vence, proveedor')
      .in('estado', ['Pendiente', 'Parcial'])
      .lte('fecha_vence', en30s).gte('fecha_vence', hoy),

    // Planilla del mes (devengada — se incurre aunque no esté pagada)
    sb.from('disabi_planilla')
      .select('salario_bruto, salario_neto, costo_total_empresa, isss_patronal, afp_patronal, estado, tipo_pago')
      .eq('periodo', ym)
      .neq('estado', 'Anulado'),

    // Comisiones del mes (devengadas)
    sb.from('disabi_comision_registros')
      .select('comision_bruta, comision_neta, retencion_isr, estado')
      .eq('periodo', ym)
      .neq('estado', 'Bloqueado'),
  ])

  const vm   = ventasMes ?? []
  const vano = ventasAno ?? []
  const gm   = gastosMes ?? []
  const cf   = costosFijos ?? []
  const pm   = planillaMes ?? []
  const com  = comisionesMes ?? []
  const cxcs  = cxcAll ?? []
  const cpps  = cppAll ?? []

  // ══════════════════════════════════════════════════════════════════
  // ESTADO DE RESULTADOS — BASE DEVENGADA
  // ══════════════════════════════════════════════════════════════════

  // INGRESOS: monto bruto de ventas devengadas (excepto Borrador y Devueltas totalmente)
  // Se usa monto (con IVA incluido, que es el precio real del cliente)
  // El IVA percibido de Link/POS va como egreso separado (costo de canal)
  // Devoluciones totales se excluyen del ingreso devengado
  const vmActivas = vm.filter(v => v.devolucion_estado !== 'Devuelta')
  const ingresosBrutos = vmActivas.reduce((a, v) => a + (v.monto || 0), 0)

  // COSTOS DE CANAL (egresos directamente vinculados al ingreso)
  // Solo sobre ventas activas (no devueltas totalmente)
  const costoPaquetera   = vmActivas.reduce((a, v) => a + (v.paquetera_costo     || 0), 0)
  const comisionPaquetera = vmActivas.reduce((a, v) => a + (v.paquetera_com_monto || 0), 0)
  const ivaPercibidoLiq  = vmActivas.reduce((a, v) => a + (v.liq_iva_percibido   || 0), 0)
  const comisionLiqPOS   = vmActivas.reduce((a, v) => a + ((v.liq_comision || 0) + (v.liq_iva_comision || 0)), 0)
  const totalCostoCanal  = costoPaquetera + comisionPaquetera + ivaPercibidoLiq + comisionLiqPOS

  // INGRESO NETO (lo que efectivamente recibe DISABI)
  const ingresoNeto = ingresosBrutos - totalCostoCanal

  // COSTO DE VENTAS (compras directamente ligadas a los productos vendidos)
  // Clasificadas en gastos como tipo_egreso='compra_local' o tipo_compra='Local'
  const costoVentas = gm
    .filter(g => g.tipo_egreso === 'compra_local' || g.tipo_compra === 'Local')
    .reduce((a, g) => a + g.monto, 0)

  // UTILIDAD BRUTA
  const utilidadBruta = ingresoNeto - costoVentas

  // GASTOS OPERATIVOS (devengados en el mes)
  const gastosOperativos = gm
    .filter(g => g.tipo_egreso === 'operativo' || (!g.tipo_egreso && g.tipo_compra !== 'Local'))
    .reduce((a, g) => a + g.monto, 0)

  // PLANILLA DEVENGADA (costo total empresa = salario bruto + ISSS patronal + AFP patronal)
  const planillaDevengada = pm.reduce((a, p) => a + (p.costo_total_empresa || 0), 0)

  // COMISIONES DEVENGADAS
  const comisionesDevengadas = com.reduce((a, c) => a + (c.comision_bruta || 0), 0)

  // COSTOS FIJOS ACTIVOS (devengados mensualmente)
  const cfActivoSum = cf.filter(c => c.activo !== false).reduce((a, c) => a + c.monto, 0)

  // TOTAL EGRESOS OPERATIVOS
  const totalEgresosOp = gastosOperativos + planillaDevengada + comisionesDevengadas + cfActivoSum

  // UTILIDAD OPERATIVA (EBITDA simplificado)
  const utilidadOperativa = utilidadBruta - totalEgresosOp

  // MARGEN
  const margenBruto = ingresoNeto > 0 ? ((utilidadBruta / ingresoNeto) * 100).toFixed(1) + '%' : '0%'
  const margenNeto  = ingresoNeto > 0 ? ((utilidadOperativa / ingresoNeto) * 100).toFixed(1) + '%' : '0%'

  // ══════════════════════════════════════════════════════════════════
  // POSICIÓN DE CARTERA (Balance simplificado)
  // ══════════════════════════════════════════════════════════════════
  const cxcPend  = cxcs.filter(x => x.estado === 'Pendiente').reduce((a, x) => a + x.saldo, 0)
  const cxcParc  = cxcs.filter(x => x.estado === 'Parcial').reduce((a, x) => a + x.saldo, 0)
  const cxcVenc  = cxcs.filter(x => x.estado === 'Vencido').reduce((a, x) => a + x.saldo, 0)
  const cxcCobMes = (cxcAbonos ?? [])
    .filter(a => (a.fecha ?? '') >= mesInicio && (a.fecha ?? '') <= mesFin)
    .reduce((a, x) => a + x.monto, 0)

  const cppPend  = cpps.filter(x => x.estado === 'Pendiente').reduce((a, x) => a + x.saldo, 0)
  const cppParc  = cpps.filter(x => x.estado === 'Parcial').reduce((a, x) => a + x.saldo, 0)
  const cppVenc  = cpps.filter(x => x.estado === 'Vencido').reduce((a, x) => a + x.saldo, 0)
  const cppPagMes = (cppPagos ?? [])
    .filter(p => (p.fecha ?? '') >= mesInicio && (p.fecha ?? '') <= mesFin)
    .reduce((a, x) => a + x.monto, 0)

  // Flujo proyectado
  const cobrosProx = (ppProximos ?? []).reduce((a, p) => a + p.total, 0)
  const pagosProx  = (cppProximos ?? []).reduce((a, p) => a + p.saldo, 0)

  // Ventas por mes (para gráficas) — base devengada
  // Excluye devoluciones totales, igual que el Estado de Resultados del mes actual
  const ventasPorMes: Record<string, { ventas: number; neto: number }> = {}
  const gastosPorMes: Record<string, number> = {}
  vano.forEach(v => {
    if (v.devolucion_estado === 'Devuelta') return  // excluir devueltas totales
    const m = (v.fecha ?? '').slice(0, 7)
    if (!m) return
    if (!ventasPorMes[m]) ventasPorMes[m] = { ventas: 0, neto: 0 }
    ventasPorMes[m].ventas += v.monto || 0
    ventasPorMes[m].neto   += v.monto_neto ?? v.monto ?? 0
  })

  const hace6m = new Date(hoy); hace6m.setMonth(hace6m.getMonth() - 5); hace6m.setDate(1)
  const { data: gastosHistorico } = await sb.from('disabi_gastos')
    .select('fecha, monto, tipo_egreso, tipo_compra')
    .gte('fecha', hace6m.toISOString().slice(0, 7) + '-01')
  // Solo gastos operativos y costo de ventas — excluir planilla/comision para evitar doble conteo
  // La planilla y comisiones devengadas ya se leen de sus tablas fuente en el P&L
  ;(gastosHistorico ?? []).forEach(g => {
    if (g.tipo_egreso === 'planilla' || g.tipo_egreso === 'comision_venta') return
    const m = (g.fecha ?? '').slice(0, 7)
    if (m) gastosPorMes[m] = (gastosPorMes[m] ?? 0) + g.monto
  })

  return {
    // ── Estado de Resultados (base devengada) ──────────────────────
    ingresosBrutos,
    totalCostoCanal,
    costoPaquetera,
    comisionPaquetera,
    ivaPercibidoLiq,
    comisionLiqPOS,
    ingresoNeto,
    costoVentas,
    utilidadBruta,
    gastosOperativos,
    planillaDevengada,
    comisionesDevengadas,
    cfActivoSum,
    totalEgresosOp,
    utilidadOperativa,
    margenBruto,
    margenNeto,

    // Alias para compatibilidad con componentes existentes
    ingresosMes:   ingresoNeto,
    gastosMesSum:  gastosOperativos + costoVentas,

    // ── CXC ────────────────────────────────────────────────────────
    cxcAll:    cxcs,
    cxcAbonos: cxcAbonos ?? [],
    cxcKpis: {
      total:     cxcs.reduce((a, x) => a + x.saldo, 0),
      pendiente: cxcPend, nPendiente: cxcs.filter(x => x.estado === 'Pendiente').length,
      parcial:   cxcParc, nParcial:   cxcs.filter(x => x.estado === 'Parcial').length,
      vencido:   cxcVenc, nVencido:   cxcs.filter(x => x.estado === 'Vencido').length,
      cobradoMes: cxcCobMes,
    },

    // ── CPP ────────────────────────────────────────────────────────
    cppAll:    cpps,
    cppPagos:  cppPagos ?? [],
    cppKpis: {
      total:     cpps.reduce((a, x) => a + x.saldo, 0),
      pendiente: cppPend, nPendiente: cpps.filter(x => x.estado === 'Pendiente').length,
      parcial:   cppParc, nParcial:   cpps.filter(x => x.estado === 'Parcial').length,
      vencido:   cppVenc, nVencido:   cpps.filter(x => x.estado === 'Vencido').length,
      pagadoMes: cppPagMes,
    },

    // ── Gastos (para tab Gastos) ───────────────────────────────────
    gastosMes: gm,
    mayorGastoMonto: [...gm].sort((a, b) => b.monto - a.monto)[0]?.monto ?? 0,
    mayorGastoCat:   [...gm].sort((a, b) => b.monto - a.monto)[0]?.categoria ?? '–',

    // ── Costos Fijos ───────────────────────────────────────────────
    costosFijos: cf,

    // ── Flujo ──────────────────────────────────────────────────────
    cobrosProx, pagosProx, flujoNeto: cobrosProx - pagosProx,
    ppProximos:  ppProximos ?? [],
    cppProximos: cppProximos ?? [],

    // ── Planilla y comisiones (para indicadores) ───────────────────
    planillaDevengadaDetalle: pm,
    comisionesDevengadasDetalle: com,

    // ── Gráficas ───────────────────────────────────────────────────
    ventasPorMes,
    gastosPorMes,

    hoy, mesActual: ym,
  }
}

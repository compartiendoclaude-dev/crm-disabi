import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// ── Datos iniciales de la página Ventas ──────────────────────────────────────
export async function getVentasPageData() {
  const sb  = await createClient()
  const hoy  = today()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const d   = new Date()
  const dow  = d.getDay()
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  const lunesStr   = lunes.toISOString().slice(0, 10)
  const domingoStr = new Date(lunes.getTime() + 6 * 86400000).toISOString().slice(0, 10)

  const [
    { data: ventas },
    { data: cotizaciones },
    { data: pendientesPago },
    { data: productos },
    { data: clientes },
    { data: devoluciones },
    { data: empleados },
    { data: oportunidades },
  ] = await Promise.all([
    sb.from('disabi_ventas')
      .select('*, items:disabi_venta_items(*, producto:disabi_productos(nombre, codigo)), vendedor:disabi_empleados(nombre, cargo)')
      .order('fecha', { ascending: false })
      .limit(200),

    sb.from('disabi_cotizaciones')
      .select('*, items:disabi_cotizacion_items(*, producto:disabi_productos(nombre, codigo))')
      .eq('tipo', 'Cotizacion')
      .order('fecha_emision', { ascending: false })
      .limit(100),

    sb.from('disabi_cotizaciones')
      .select('*, items:disabi_cotizacion_items(*, producto:disabi_productos(nombre, codigo))')
      .eq('tipo', 'Pendiente de Pago')
      .order('fecha_emision', { ascending: false })
      .limit(100),

    sb.from('disabi_productos')
      .select('id, codigo, nombre, precio_venta, costo_unitario, stock_actual, activo')
      .eq('activo', true)
      .order('nombre'),

    sb.from('disabi_clientes')
      .select('id, nombre, contacto, email, telefono, sector, limite_credito')
      .order('nombre')
      .limit(600),

    sb.from('disabi_devoluciones')
      .select('*, venta:disabi_ventas(numero, nombre, monto, cobro), items:disabi_devolucion_items(*, producto:disabi_productos(nombre, codigo))')
      .order('fecha', { ascending: false })
      .limit(100),

    sb.from('disabi_empleados')
      .select('id, nombre, cargo, tipo_contrato, activo')
      .eq('activo', true)
      .order('nombre'),

    // Oportunidades — embudo comercial previo a la Cotización
    sb.from('disabi_oportunidades')
      .select('*, vendedor:disabi_empleados(nombre)')
      .order('created_at', { ascending: false })
      .limit(300),
  ])

  // KPIs de Ventas
  const vAll = ventas ?? []
  const cobradas = vAll.filter(v => v.cobro === 'Cobrado')
  const hoyVentas = cobradas.filter(v => v.fecha === hoy)
  const semVentas = cobradas.filter(v => v.fecha >= lunesStr && v.fecha <= domingoStr)
  const mesVentas = cobradas.filter(v => v.fecha >= mesInicio && v.fecha <= mesFin)

  const kpis = {
    ultimaMonto:   vAll[0]?.monto ?? 0,
    ultimaFecha:   vAll[0]?.fecha ?? '–',
    ultimaCliente: vAll[0]?.nombre ?? '–',
    diaTotal:      hoyVentas.reduce((a, v) => a + v.monto, 0),
    diaItems:      hoyVentas.length,
    semTotal:      semVentas.reduce((a, v) => a + v.monto, 0),
    semItems:      semVentas.length,
    mesTotal:      mesVentas.reduce((a, v) => a + v.monto, 0),
    mesItems:      mesVentas.length,
  }

  // KPIs de Cotizaciones
  const cots = cotizaciones ?? []
  const cotKpis = {
    total:     cots.length,
    enviadas:  cots.filter(c => c.estado === 'Enviada').length,
    aprobadas: cots.filter(c => c.estado === 'Aprobada').length,
    aprobMonto: cots.filter(c => c.estado === 'Aprobada').reduce((a, c) => a + c.total, 0),
    rechazadas: cots.filter(c => c.estado === 'Rechazada').length,
    tasa: cots.filter(c => ['Aprobada','Rechazada'].includes(c.estado)).length > 0
      ? Math.round(cots.filter(c => c.estado === 'Aprobada').length /
          cots.filter(c => ['Aprobada','Rechazada'].includes(c.estado)).length * 100)
      : 0,
  }

  // KPIs de Pendientes de Pago
  // El `estado` de disabi_cotizaciones (tipo 'Pendiente de Pago') nunca pasa a
  // 'Vencido' en ningún flujo de escritura — nace 'Pendiente' y solo cambia a
  // 'Pagado' (ver /api/ventas action=pagar_pp). Mismo bug que en CxC/CPP
  // (lib/utils.ts estaVencida), pero esta tabla usa fecha_entrega en vez de
  // fecha_vence y no tiene monto_pendiente (es un monto único, no parcial),
  // así que se deriva por fecha directamente en vez de reusar estaVencida().
  const pps = pendientesPago ?? []
  const ppActivos  = pps.filter(p => p.estado !== 'Pagado')
  const ppVencidos = ppActivos.filter(p => (p.fecha_entrega ?? '') < hoy)
  const ppSemana   = ppActivos.filter(p => p.fecha_entrega >= lunesStr && p.fecha_entrega <= domingoStr)
  const ppKpis = {
    total:       ppActivos.length,
    totalMonto:  ppActivos.reduce((a, p) => a + p.total, 0),
    vencidos:    ppVencidos.length,
    vencidosMonto: ppVencidos.reduce((a, p) => a + p.total, 0),
    semana:      ppSemana.length,
    semanaMonto: ppSemana.reduce((a, p) => a + p.total, 0),
  }

  const devs = devoluciones ?? []
  const devKpis = {
    totalMes:     devs.filter(d => (d.fecha ?? '') >= mesInicio && (d.fecha ?? '') <= mesFin && d.estado === 'Procesada').length,
    montoMes:     devs.filter(d => (d.fecha ?? '') >= mesInicio && (d.fecha ?? '') <= mesFin && d.estado === 'Procesada').reduce((a, d) => a + d.monto_devuelto, 0),
    totalGeneral: devs.filter(d => d.estado === 'Procesada').length,
    montoGeneral: devs.filter(d => d.estado === 'Procesada').reduce((a, d) => a + d.monto_devuelto, 0),
  }

  // KPIs de Oportunidades — no se construyen reportes todavía (por decisión de
  // José), pero created_at/fecha_cierre_real quedan guardados desde ya para
  // poder calcular después cuántas oportunidades se vieron por día/semana/mes
  // y la tasa de conversión. Aquí solo se arma un resumen básico de estado
  // actual del embudo, igual que las demás pestañas de Ventas.
  const ops = oportunidades ?? []
  const opsAbiertas = ops.filter(o => o.etapa !== 'Ganada' && o.etapa !== 'Perdida')
  const opsGanadasMes  = ops.filter(o => o.etapa === 'Ganada'  && (o.fecha_cierre_real ?? '') >= mesInicio && (o.fecha_cierre_real ?? '') <= mesFin)
  const opsPerdidasMes = ops.filter(o => o.etapa === 'Perdida' && (o.fecha_cierre_real ?? '') >= mesInicio && (o.fecha_cierre_real ?? '') <= mesFin)
  const opsCerradasMes = opsGanadasMes.length + opsPerdidasMes.length
  const opsNuevasHoy    = ops.filter(o => (o.created_at ?? '').slice(0, 10) === hoy).length
  const opsNuevasSemana = ops.filter(o => (o.created_at ?? '').slice(0, 10) >= lunesStr && (o.created_at ?? '').slice(0, 10) <= domingoStr).length
  const opsNuevasMes    = ops.filter(o => (o.created_at ?? '').slice(0, 10) >= mesInicio && (o.created_at ?? '').slice(0, 10) <= mesFin).length
  const opKpis = {
    abiertas:       opsAbiertas.length,
    valorPipeline:  opsAbiertas.reduce((a, o) => a + (o.valor_estimado ?? 0), 0),
    ganadasMes:     opsGanadasMes.length,
    ganadasMesMonto: opsGanadasMes.reduce((a, o) => a + (o.valor_estimado ?? 0), 0),
    perdidasMes:    opsPerdidasMes.length,
    tasaConversionMes: opsCerradasMes > 0 ? Math.round(opsGanadasMes.length / opsCerradasMes * 100) : 0,
    nuevasHoy: opsNuevasHoy, nuevasSemana: opsNuevasSemana, nuevasMes: opsNuevasMes,
  }

  return {
    ventas:            vAll,
    cotizaciones:      cots,
    pendientesPago:    pps,
    productos:         productos ?? [],
    clientes:          clientes ?? [],
    empleados:         empleados ?? [],
    devoluciones:      devs,
    ventasDevolvibles: vAll.filter(v => v.cobro !== 'Borrador' && v.devolucion_estado !== 'Devuelta'),
    devKpis,
    kpis,
    cotKpis,
    ppKpis,
    oportunidades: ops,
    opKpis,
    lunesStr,
    mesActual: ym,
    mesInicio, mesFin,
    hoy,
  }
}

import { createClient } from '@/lib/supabase-server'
import { nowYM } from '@/lib/utils'

export async function getDtePageData() {
  const sb  = await createClient()
  const ym  = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = ym + '-31'

  const [
    { data: dtes },
    { data: ventas },
  ] = await Promise.all([
    sb.from('disabi_dte')
      .select('*, venta:disabi_ventas(numero, nombre)')
      .order('fecha_emision', { ascending: false })
      .limit(500),

    sb.from('disabi_ventas')
      .select('id, numero, nombre, fecha, monto, cobro')
      .not('cobro', 'eq', 'Borrador')
      .order('fecha', { ascending: false })
      .limit(300),
  ])

  const todos = dtes ?? []

  // ── KPIs generales
  const mesDtes    = todos.filter(d => d.fecha_emision >= mesInicio && d.fecha_emision <= mesFin)
  const fcf        = todos.filter(d => d.tipo_dte === '01')
  const ccf        = todos.filter(d => d.tipo_dte === '03')
  const nc         = todos.filter(d => d.tipo_dte === '05')
  const otrosTipos = todos.filter(d => !['01','03','05'].includes(d.tipo_dte))

  const kpis = {
    total:        todos.length,
    totalPagar:   todos.reduce((a, d) => a + (d.total_pagar ?? 0), 0),
    mesCantidad:  mesDtes.length,
    mesPagar:     mesDtes.reduce((a, d) => a + (d.total_pagar ?? 0), 0),
    fcf:          fcf.length,
    ccf:          ccf.length,
    nc:           nc.length,
    otros:        otrosTipos.length,
    vinculados:   todos.filter(d => d.venta_id).length,
    sinVincular:  todos.filter(d => !d.venta_id).length,
  }

  // ── Resumen por mes (últimos 6 meses)
  const porMes: Record<string, { mes: string; cantidad: number; total: number }> = {}
  todos.forEach(d => {
    const m = (d.fecha_emision ?? '').slice(0, 7)
    if (!m) return
    if (!porMes[m]) porMes[m] = { mes: m, cantidad: 0, total: 0 }
    porMes[m].cantidad++
    porMes[m].total += d.total_pagar ?? 0
  })
  const resumenMes = Object.values(porMes).sort((a, b) => b.mes.localeCompare(a.mes)).slice(0, 6)

  // ── Resumen por tipo
  const porTipo: Record<string, { tipo: string; cantidad: number; total: number }> = {}
  todos.forEach(d => {
    const t = d.tipo_dte ?? 'XX'
    if (!porTipo[t]) porTipo[t] = { tipo: t, cantidad: 0, total: 0 }
    porTipo[t].cantidad++
    porTipo[t].total += d.total_pagar ?? 0
  })
  const resumenTipo = Object.values(porTipo).sort((a, b) => b.cantidad - a.cantidad)

  return {
    dtes: todos,
    ventas: ventas ?? [],
    kpis,
    resumenMes,
    resumenTipo,
    mesActual: ym,
  }
}

'use client'
import { useState } from 'react'
import AuditoriaTab from './AuditoriaTab'
import { fmtUSD, monthLabel } from '@/lib/utils'

interface Venta { id: string; numero?: string; nombre: string; fecha: string; monto: number; monto_neto?: number; cobro: string; canal?: string; metodo_pago?: string; paquetera?: string; paquetera_costo?: number; paquetera_com_monto?: number; liq_monto_liquido?: number; items?: { descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }[] }
interface CXCRow { id: string; numero?: string; cliente: string; fecha_emision: string; fecha_vence?: string; monto: number; saldo: number; estado: string }
interface CPPRow { id: string; numero?: string; proveedor: string; fecha_emision: string; fecha_vence?: string; monto: number; saldo: number; estado: string }
interface Gasto { id: string; fecha: string; categoria?: string; descripcion?: string; monto: number; factura?: string; proveedor?: string }
interface Producto { id: string; codigo: string; nombre: string; precio_venta: number; costo_unitario?: number; stock_actual: number; stock_minimo?: number; categoria?: string }
interface Cliente { id: string; nombre: string; sector?: string; fecha_registro?: string }

interface FinMes {
  ingresosBrutos: number; costoCanal: number; ingresoNeto: number
  costoVentas: number; utilidadBruta: number
  gastosOperativos: number; planillaDevengada: number; comisionesDevengadas: number
  costosFijosSum: number; totalEgresosOp: number; utilidadOperativa: number
  margenBrutoPct: number; margenNetoPct: number
}

interface Props {
  ventas: Venta[]; gastos: Gasto[]; costosFijos: { descripcion: string; monto: number; categoria?: string }[]
  cxc: CXCRow[]; cpp: CPPRow[]; productos: Producto[]; clientes: Cliente[]
  ppPendientes: { total: number; cliente: string; fecha_entrega?: string }[]
  finMes: FinMes
  hoy: string; mesActual: string; mesInicio: string; mesFin: string
}

const REPORTES = [
  { key: 'resumen',               icon: '📊', titulo: 'Resumen Ejecutivo',          desc: 'KPIs principales del negocio' },
  { key: 'estado_resultados',     icon: '📄', titulo: 'Estado de Resultados',        desc: 'Ingresos, egresos y utilidad del mes' },
  { key: 'ventas',                icon: '💰', titulo: 'Historial de Ventas',          desc: 'Detalle de todas las ventas' },
  { key: 'cxc',                   icon: '💳', titulo: 'Cuentas por Cobrar (CxC)',     desc: 'Cartera pendiente de cobro' },
  { key: 'cpp',                   icon: '💸', titulo: 'Cuentas por Pagar (CPP)',      desc: 'Obligaciones con proveedores' },
  { key: 'inventario',            icon: '📦', titulo: 'Inventario y Stock',           desc: 'Estado del catálogo de productos' },
  { key: 'indicadores',           icon: '📈', titulo: 'Indicadores Financieros',      desc: 'Ratios y métricas clave' },
  { key: 'clientes',              icon: '👥', titulo: 'Maestro de Clientes',          desc: 'Base de clientes registrados' },
  { key: 'gastos',                icon: '💸', titulo: 'Registro de Gastos',           desc: 'Gastos variables del período' },
  { key: 'flujo_efectivo',        icon: '💧', titulo: 'Flujo de Efectivo',            desc: 'Cobros y pagos proyectados' },
  { key: 'liquidaciones_paquetera', icon: '📦', titulo: 'Liquidaciones Paquetera',    desc: 'Comisiones y netos por paquetera' },
  { key: 'auditoria',                icon: '🔍', titulo: 'Log de Auditoría',             desc: 'Historial de cambios por usuario' },
] as const

type ReporteKey = typeof REPORTES[number]['key']

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ReportesModule({ ventas, gastos, costosFijos, cxc, cpp, productos, clientes, ppPendientes, finMes, hoy, mesActual, mesInicio, mesFin }: Props) {
  const [desde, setDesde] = useState(mesInicio)
  const [hasta, setHasta] = useState(mesFin)
  const [preview, setPreview] = useState<ReporteKey | null>(null)

  // Filtrar ventas por rango de fecha
  const ventasFiltradas = ventas.filter(v => v.fecha >= desde && v.fecha <= hasta && v.cobro !== 'Borrador')
  const cobradasFilt    = ventasFiltradas.filter(v => v.cobro === 'Cobrado')
  const gastosFiltrados = gastos.filter(g => g.fecha >= desde && g.fecha <= hasta)

  const ingresosFilt = cobradasFilt.reduce((a, v) => a + v.monto, 0)
  const gastosFilt   = gastosFiltrados.reduce((a, g) => a + g.monto, 0)
  // cfTotal removed — Estado de Resultados now uses finMes.costosFijosSum
  // utilidadFilt removed — Estado de Resultados now uses finMes props

  function printReporte(key: ReporteKey) {
    setPreview(key)
    setTimeout(() => window.print(), 300)
  }

  const renderPreview = (key: ReporteKey) => {
    switch (key) {
      case 'resumen':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📊 Resumen Ejecutivo — {desde} al {hasta}</h2>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 16, fontStyle: 'italic' }}>Base devengada · todos los importes incluyen ventas a crédito y en liquidación</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { l: 'Ingreso Neto Devengado', v: fmtUSD(finMes.ingresoNeto), c: 'var(--green)' },
                { l: 'Costo de Ventas', v: fmtUSD(finMes.costoVentas), c: 'var(--red)' },
                { l: 'Utilidad Bruta', v: fmtUSD(finMes.utilidadBruta), c: 'var(--teal)' },
                { l: 'Utilidad Operativa', v: fmtUSD(finMes.utilidadOperativa), c: finMes.utilidadOperativa >= 0 ? 'var(--teal)' : 'var(--red)' },
                { l: 'Nº de ventas', v: String(ventasFiltradas.length), c: 'var(--blue)' },
                { l: 'CxC pendiente', v: fmtUSD(cxc.filter(x => x.estado !== 'Pagado').reduce((a, x) => a + x.saldo, 0)), c: 'var(--amber)' },
              ].map(k => (
                <div key={k.l} className="kpi-card" style={{ borderTop: `3px solid ${k.c}` }}>
                  <div className="kpi-label">{k.l}</div>
                  <div className="kpi-value" style={{ color: k.c, fontSize: 18 }}>{k.v}</div>
                </div>
              ))}
            </div>
          </div>
        )

      case 'estado_resultados':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📄 Estado de Resultados — {monthLabel(mesActual)}</h2>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 16, fontStyle: 'italic' }}>
              Base devengada · NIIF para PYMES Sección 2 · Período: {mesInicio} → {mesFin}
            </div>
            <table className="tbl" style={{ marginBottom: 12 }}>
              <tbody>
                {([
                  { label: 'INGRESOS', monto: null, tipo: 'seccion' },
                  { label: 'Ingresos brutos de ventas (devengados)', monto: finMes.ingresosBrutos, tipo: 'ingreso' },
                  ...(finMes.costoCanal > 0 ? [{ label: '(−) Costos de canal (paquetera + Link/POS)', monto: -finMes.costoCanal, tipo: 'deduccion' as const }] : []),
                  { label: '= Ingreso Neto', monto: finMes.ingresoNeto, tipo: 'subtotal' },
                  { label: 'COSTO DE VENTAS', monto: null, tipo: 'seccion' },
                  { label: '(−) Costo de mercadería vendida (compras locales)', monto: -finMes.costoVentas, tipo: 'deduccion' },
                  { label: '= UTILIDAD BRUTA', monto: finMes.utilidadBruta, tipo: 'subtotal' },
                  { label: 'GASTOS OPERATIVOS', monto: null, tipo: 'seccion' },
                  ...(finMes.gastosOperativos > 0 ? [{ label: '(−) Gastos variables operativos', monto: -finMes.gastosOperativos, tipo: 'deduccion' as const }] : []),
                  ...(finMes.planillaDevengada > 0 ? [{ label: '(−) Planilla y honorarios (devengado)', monto: -finMes.planillaDevengada, tipo: 'deduccion' as const }] : []),
                  ...(finMes.comisionesDevengadas > 0 ? [{ label: '(−) Comisiones a vendedores (devengado)', monto: -finMes.comisionesDevengadas, tipo: 'deduccion' as const }] : []),
                  { label: '(−) Costos fijos (devengado)', monto: -finMes.costosFijosSum, tipo: 'deduccion' },
                  { label: '= UTILIDAD OPERATIVA', monto: finMes.utilidadOperativa, tipo: 'resultado' },
                ] as { label: string; monto: number | null; tipo: string }[]).map((r, i) => {
                  if (r.tipo === 'seccion') return (
                    <tr key={i}><td colSpan={2} style={{ padding: '12px 12px 4px', fontSize: 10, fontWeight: 800, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.6px', borderTop: '1px solid var(--bdr)' }}>{r.label}</td></tr>
                  )
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--bdr)' }}>
                      <td style={{ padding: r.tipo === 'subtotal' || r.tipo === 'resultado' ? '9px 12px' : '8px 12px 8px 24px', fontWeight: r.tipo === 'resultado' || r.tipo === 'subtotal' ? 700 : 400, fontSize: r.tipo === 'resultado' ? 14 : 12 }}>{r.label}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: r.tipo === 'resultado' || r.tipo === 'subtotal' ? 800 : 600, fontSize: r.tipo === 'resultado' ? 14 : 12,
                        color: r.tipo === 'ingreso' || r.tipo === 'subtotal' ? 'var(--green)' : r.tipo === 'deduccion' ? 'var(--red)' : (r.monto ?? 0) >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                        {r.monto !== null ? fmtUSD(Math.abs(r.monto)) : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
              <span style={{ color: 'var(--txt3)' }}>Margen bruto: <strong style={{ color: 'var(--teal)' }}>{finMes.margenBrutoPct.toFixed(1)}%</strong></span>
              <span style={{ color: 'var(--txt3)' }}>Margen neto: <strong style={{ color: finMes.utilidadOperativa >= 0 ? 'var(--teal)' : 'var(--red)' }}>{finMes.margenNetoPct.toFixed(1)}%</strong></span>
            </div>
          </div>
        )

      case 'ventas':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>💰 Historial de Ventas — {desde} al {hasta}</h2>
            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--txt2)' }}>
              Total cobrado: <strong style={{ color: 'var(--teal)' }}>{fmtUSD(ingresosFilt)}</strong> · {cobradasFilt.length} ventas
            </div>
            <table className="tbl">
              <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Método</th><th>Monto</th><th>Estado</th></tr></thead>
              <tbody>
                {ventasFiltradas.slice(0, 100).map(v => (
                  <tr key={v.id}>
                    <td className="mono" style={{ fontSize: 10 }}>{v.numero ?? '–'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{v.fecha}</td>
                    <td style={{ fontWeight: 600 }}>{v.nombre}</td>
                    <td style={{ fontSize: 11 }}>{v.metodo_pago ?? '–'}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(v.monto)}</td>
                    <td><span className={`badge ${v.cobro === 'Cobrado' ? 'badge-green' : 'badge-amber'}`}>{v.cobro}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'cxc':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>💳 Cuentas por Cobrar</h2>
            <table className="tbl">
              <thead><tr><th>#</th><th>Cliente</th><th>Emisión</th><th>Vence</th><th>Monto orig.</th><th>Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                {cxc.map(x => (
                  <tr key={x.id}>
                    <td className="mono" style={{ fontSize: 10 }}>{x.numero ?? '–'}</td>
                    <td style={{ fontWeight: 600 }}>{x.cliente}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{x.fecha_emision}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{x.fecha_vence ?? '–'}</td>
                    <td className="mono">{fmtUSD(x.monto)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: x.saldo <= 0 ? 'var(--green)' : 'var(--amber)' }}>{fmtUSD(x.saldo)}</td>
                    <td><span className={`badge ${x.estado === 'Pagado' ? 'badge-green' : x.estado === 'Vencido' ? 'badge-red' : 'badge-amber'}`}>{x.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'cpp':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>💸 Cuentas por Pagar</h2>
            <table className="tbl">
              <thead><tr><th>#</th><th>Proveedor</th><th>Emisión</th><th>Vence</th><th>Monto orig.</th><th>Saldo</th><th>Estado</th></tr></thead>
              <tbody>
                {cpp.map(x => (
                  <tr key={x.id}>
                    <td className="mono" style={{ fontSize: 10 }}>{x.numero ?? '–'}</td>
                    <td style={{ fontWeight: 600 }}>{x.proveedor}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{x.fecha_emision}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{x.fecha_vence ?? '–'}</td>
                    <td className="mono">{fmtUSD(x.monto)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: x.saldo <= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtUSD(x.saldo)}</td>
                    <td><span className={`badge ${x.estado === 'Pagado' ? 'badge-green' : x.estado === 'Vencido' ? 'badge-red' : 'badge-amber'}`}>{x.estado}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'inventario':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>📦 Inventario y Stock</h2>
            <table className="tbl">
              <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Stock</th><th>Mín.</th><th>Precio Vta.</th><th>Costo</th><th>Margen</th></tr></thead>
              <tbody>
                {productos.map(p => {
                  const costo = p.costo_unitario ?? 0
                  const margen = p.precio_venta > 0 && costo > 0 ? ((p.precio_venta - costo) / p.precio_venta * 100).toFixed(1) + '%' : '–'
                  return (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontSize: 10 }}>{p.codigo}</td>
                      <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ fontSize: 11 }}>{p.categoria ?? '–'}</td>
                      <td className="mono" style={{ fontWeight: 700, color: (p.stock_actual ?? 0) <= 0 ? 'var(--red)' : (p.stock_actual ?? 0) <= (p.stock_minimo ?? 0) ? 'var(--amber)' : 'var(--green)' }}>{p.stock_actual}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{p.stock_minimo ?? 0}</td>
                      <td className="mono">{fmtUSD(p.precio_venta)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtUSD(costo)}</td>
                      <td style={{ color: 'var(--green)', fontSize: 11 }}>{margen}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )

      case 'indicadores': {
        const cxcTotal       = cxc.filter(x => x.estado !== 'Pagado').reduce((a, x) => a + x.saldo, 0)
        const cppTotal       = cpp.filter(x => x.estado !== 'Pagado').reduce((a, x) => a + x.saldo, 0)
        const totalCostoVar  = finMes.costoVentas + finMes.gastosOperativos
        const margenContrib  = finMes.ingresoNeto > 0 ? (finMes.ingresoNeto - totalCostoVar) / finMes.ingresoNeto : 0
        const totalFijos     = finMes.costosFijosSum + finMes.planillaDevengada + finMes.comisionesDevengadas
        const puntoEquil     = margenContrib > 0 ? totalFijos / margenContrib : 0
        const diasCobro      = finMes.ingresosBrutos > 0 ? Math.round(cxcTotal / (finMes.ingresosBrutos / 30)) : 0
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>📈 Indicadores Financieros</h2>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 12, fontStyle: 'italic' }}>Base devengada · período {mesInicio} → {mesFin}</div>
            <table className="tbl">
              <thead><tr><th>Indicador</th><th>Valor</th><th>Descripción</th></tr></thead>
              <tbody>
                {[
                  { label: 'Ingreso Neto Devengado',    value: fmtUSD(finMes.ingresoNeto),        desc: `Ingresos brutos menos costos de canal · ${ventasFiltradas.length} ventas` },
                  { label: 'Utilidad Bruta',            value: fmtUSD(finMes.utilidadBruta),       desc: 'Ingreso Neto menos Costo de Ventas' },
                  { label: 'Utilidad Operativa',        value: fmtUSD(finMes.utilidadOperativa),   desc: 'Después de todos los egresos del período' },
                  { label: 'Margen Bruto',              value: finMes.margenBrutoPct.toFixed(1) + '%', desc: 'Utilidad Bruta / Ingreso Neto' },
                  { label: 'Margen Operativo',          value: finMes.margenNetoPct.toFixed(1) + '%', desc: 'Utilidad Operativa / Ingreso Neto' },
                  { label: 'Margen de Contribución',   value: (margenContrib * 100).toFixed(1) + '%', desc: 'Porcentaje disponible para cubrir costos fijos' },
                  { label: 'Punto de Equilibrio',       value: puntoEquil > 0 ? fmtUSD(puntoEquil) : '–', desc: 'Costos fijos estructurales ÷ margen de contribución' },
                  { label: 'CxC Total Pendiente',       value: fmtUSD(cxcTotal),                   desc: `${cxc.filter(x => x.estado !== 'Pagado').length} facturas por cobrar` },
                  { label: 'CPP Total Pendiente',       value: fmtUSD(cppTotal),                   desc: `${cpp.filter(x => x.estado !== 'Pagado').length} facturas por pagar` },
                  { label: 'Ratio CPP / CxC',          value: cxcTotal > 0 ? (cppTotal / cxcTotal).toFixed(2) : '–', desc: '< 1 indica posición favorable de liquidez' },
                  { label: 'Días Promedio de Cobro',   value: diasCobro > 0 ? diasCobro + 'd' : '–', desc: 'CxC pendiente / (Ventas brutas ÷ 30)' },
                  { label: 'Cobertura de CF',          value: totalFijos > 0 ? (finMes.ingresoNeto / totalFijos).toFixed(2) + 'x' : '–', desc: 'Ingreso Neto / costos fijos estructurales' },
                ].map(r => (
                  <tr key={r.label}>
                    <td style={{ fontWeight: 600 }}>{r.label}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{r.value}</td>
                    <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }

      case 'clientes':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>👥 Maestro de Clientes ({clientes.length} registrados)</h2>
            <table className="tbl">
              <thead><tr><th>Cliente</th><th>Sector</th><th>Fecha registro</th></tr></thead>
              <tbody>
                {clientes.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>{c.nombre}</td>
                    <td style={{ fontSize: 11 }}>{c.sector ?? '–'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{c.fecha_registro ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'gastos':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>💸 Registro de Gastos — {desde} al {hasta}</h2>
            <div style={{ marginBottom: 12, fontSize: 12 }}>Total gastos: <strong style={{ color: 'var(--red)' }}>{fmtUSD(gastosFilt)}</strong></div>
            <table className="tbl">
              <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Monto</th><th>Factura</th></tr></thead>
              <tbody>
                {gastosFiltrados.map(g => (
                  <tr key={g.id}>
                    <td className="mono" style={{ fontSize: 11 }}>{g.fecha}</td>
                    <td><span className="badge badge-gray">{g.categoria ?? '–'}</span></td>
                    <td style={{ fontSize: 12 }}>{g.descripcion ?? '–'}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(g.monto)}</td>
                    <td style={{ fontSize: 11 }}>{g.factura ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )

      case 'flujo_efectivo':
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>💧 Flujo de Efectivo Proyectado</h2>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="card">
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>💰 PP por cobrar pendientes ({ppPendientes.length})</div>
                  {ppPendientes.slice(0, 10).map((pp, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--bdr)' }}>
                      <span>{pp.cliente}</span>
                      <span className="mono" style={{ color: 'var(--green)', fontWeight: 700 }}>{fmtUSD(pp.total)}</span>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', marginBottom: 8 }}>💸 CPP por pagar pendientes</div>
                  {cpp.filter(x => x.estado !== 'Pagado').slice(0, 10).map(x => (
                    <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0', borderBottom: '1px solid var(--bdr)' }}>
                      <span>{x.proveedor}</span>
                      <span className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>{fmtUSD(x.saldo)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )

      case 'liquidaciones_paquetera': {
        const conPaq = ventasFiltradas.filter(v => v.paquetera)
        const paqueteras = Array.from(new Set(conPaq.map(v => v.paquetera))).filter(Boolean)
        return (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12 }}>📦 Liquidaciones Paquetera — {desde} al {hasta}</h2>
            {paqueteras.map(paq => {
              const rows = conPaq.filter(v => v.paquetera === paq)
              const totalMonto    = rows.reduce((a, v) => a + v.monto, 0)
              const totalComision = rows.reduce((a, v) => a + (v.paquetera_com_monto ?? 0), 0)
              const totalCosto    = rows.reduce((a, v) => a + (v.paquetera_costo ?? 0), 0)
              const totalNeto     = rows.reduce((a, v) => a + (v.monto_neto ?? v.monto), 0)
              return (
                <div key={paq as string} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', marginBottom: 8 }}>{paq as string}</div>
                  <table className="tbl" style={{ marginBottom: 8 }}>
                    <thead><tr><th>Fecha</th><th>Cliente</th><th>Monto venta</th><th>Costo envío</th><th>Comisión</th><th>Neto DISABI</th></tr></thead>
                    <tbody>
                      {rows.map(v => (
                        <tr key={v.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{v.fecha}</td>
                          <td style={{ fontWeight: 600 }}>{v.nombre}</td>
                          <td className="mono">{fmtUSD(v.monto)}</td>
                          <td className="mono" style={{ color: 'var(--red)' }}>{fmtUSD(v.paquetera_costo ?? 0)}</td>
                          <td className="mono" style={{ color: 'var(--amber)' }}>{fmtUSD(v.paquetera_com_monto ?? 0)}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtUSD(v.monto_neto ?? v.monto)}</td>
                        </tr>
                      ))}
                      <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                        <td colSpan={2}>TOTALES</td>
                        <td className="mono">{fmtUSD(totalMonto)}</td>
                        <td className="mono" style={{ color: 'var(--red)' }}>{fmtUSD(totalCosto)}</td>
                        <td className="mono" style={{ color: 'var(--amber)' }}>{fmtUSD(totalComision)}</td>
                        <td className="mono" style={{ color: 'var(--green)' }}>{fmtUSD(totalNeto)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )
            })}
            {paqueteras.length === 0 && <div style={{ color: 'var(--txt3)', fontSize: 12 }}>Sin ventas con paquetera en el período seleccionado.</div>}
          </div>
        )
      }

      case 'auditoria':
        return <AuditoriaTab />

      default: return null
    }
  }

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: block !important; }
          body { background: white !important; color: black !important; }
          .modal-overlay { display: none !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div style={{ padding: 20 }}>
        {/* Filtros de fecha */}
        <div className="card no-print" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>Período:</span>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }} />
            <span style={{ color: 'var(--txt3)', fontSize: 12 }}>→</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }} />
            <button className="btn btn-secondary btn-sm" onClick={() => { setDesde(mesInicio); setHasta(mesFin) }}>Este mes</button>
            <button className="btn btn-secondary btn-sm" onClick={() => {
              const ini = new Date(hoy); ini.setFullYear(ini.getFullYear(), 0, 1)
              setDesde(ini.toISOString().slice(0, 10)); setHasta(hoy)
            }}>Este año</button>
          </div>
        </div>

        {/* Grid de reportes */}
        <div className="no-print" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
          {REPORTES.map(r => (
            <div key={r.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 24, marginBottom: 4 }}>{r.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>{r.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{r.desc}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => setPreview(preview === r.key ? null : r.key)}>
                  {preview === r.key ? '▲ Cerrar' : '👁 Vista previa'}
                </button>
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => printReporte(r.key)}>
                  🖨️ Imprimir / PDF
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Vista previa */}
        {preview && (
          <div className="card no-print" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt3)' }}>VISTA PREVIA</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPreview(null)}>✕ Cerrar</button>
            </div>
            {renderPreview(preview)}
          </div>
        )}

        {/* Print-only area */}
        <div className="print-only" style={{ padding: '20px', color: '#000', fontFamily: 'Arial, sans-serif' }}>
          {preview && renderPreview(preview)}
          <div style={{ marginTop: 40, borderTop: '1px solid #ccc', paddingTop: 10, fontSize: 10, color: '#666' }}>
            DISABI S.A. de C.V. · Generado el {hoy}
          </div>
        </div>
      </div>
    </>
  )
}

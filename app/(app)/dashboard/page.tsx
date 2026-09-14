import { Suspense } from 'react'
import Topbar from '@/components/layout/Topbar'
import KPICard from '@/components/ui/KPICard'
import { getDashboardData } from '@/lib/dashboard-data'
import { fmtUSD, fmtPct, monthLabel } from '@/lib/utils'
import { DashboardChartsSection } from './DashboardChartsSection'
import AlertasPanel from '@/components/dashboard/AlertasPanel'
import MesSelector from './MesSelector'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { mes?: string }
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const d = await getDashboardData(searchParams?.mes)

  const mesLabel = monthLabel(d.mesActual)
  const anioSeleccionado = d.mesActual.slice(0, 4)
  const anioActual = String(new Date().getFullYear())

  // ── Estado de Resultados — barras comparativas ──────────────────────────
  const ingresos  = d.ventasMesTotal
  const gastos    = d.gastosTotal + d.costosFijosSum
  const utilidad  = ingresos - gastos
  const baseline  = ingresos > 0 ? ingresos : 1
  const gastosPct = Math.max(0, Math.min(100, (gastos / baseline) * 100))
  const margenPct = (utilidad / baseline) * 100
  const utilidadEsPositiva = utilidad >= 0

  return (
    <>
      <Topbar titulo="📊 Resumen Ejecutivo" subtitulo={`Período: ${mesLabel}`} />
      <div style={{ padding: '20px', maxWidth: '1400px' }}>

        <Suspense fallback={<div style={{ height: 38 }} />}>
          <MesSelector mesActual={d.mesActual} esMesActual={d.esMesActual} />
        </Suspense>

        {/* ── Ventas y Cobros ── */}
        <div className="res-section-label">📈 Ventas y Cobros</div>
        <div className="res-kpi-grid">
          <KPICard label="Ventas del Mes" value={fmtUSD(d.ventasMesTotal)} icon="💵"
            sub={`${d.itemsMes} ventas cobradas · ${mesLabel}`} color="teal" />
          <KPICard label="Venta Semanal" value={fmtUSD(d.ventasSemTotal)} icon="🗓️"
            sub={`${d.itemsSem} ventas esta semana`} color="blue" />
          <KPICard label="Venta del Día" value={fmtUSD(d.ventasHoyTotal)} icon="☀️"
            sub={`${d.itemsHoy} ventas hoy · ${d.hoy}`} color="green" />
          <KPICard label="CxC Pendiente" value={fmtUSD(d.cxcTotal)} icon="💳"
            sub={d.cxcVencido > 0 ? `⚠️ ${fmtUSD(d.cxcVencido)} vencido` : 'Sin vencidos'} color="amber" />
          <KPICard label="CPP Pendiente" value={fmtUSD(d.cppTotal)} icon="📤"
            sub="cuentas por pagar" color="red" />
          <KPICard label="Meta Anual" value={fmtPct(d.metaAnualPct)} icon="🎯"
            sub={`${fmtUSD(d.ventasAnoTotal)} de $200,000${anioSeleccionado !== anioActual ? ` · año ${anioSeleccionado}` : ''}`}
            color="purple" progress={d.metaAnualPct} />
        </div>

        {/* ── Operación ── */}
        <div className="res-section-label">⚙️ Operación</div>
        <div className="res-kpi-grid">
          <KPICard label="Efectivo Hoy" value={fmtUSD(d.ventasHoyTotal)} icon="💰"
            sub="ventas cobradas hoy" color="green" />
          <KPICard label="Efectivo Semana" value={fmtUSD(d.ventasSemTotal)} icon="🏦"
            sub="cobradas lun–hoy" color="teal" />
          <KPICard label="Neto Semana" value={fmtUSD(d.netoSemana)} icon="⚖️"
            sub="efectivo − gastos est." color="blue" />
          <KPICard label="Liquidación Pend." value={fmtUSD(d.liquidacionHoy)} icon="⏱️"
            sub="Link de Pago / POS hoy" color="purple" />
          <KPICard label="Ticket Promedio Mes" value={fmtUSD(d.ticketMes)} icon="🧾"
            sub={`por venta · ${mesLabel}`} color="teal" />
          <KPICard label="Ticket Promedio Sem." value={fmtUSD(d.ticketSem)} icon="🧾"
            sub="por venta esta semana" color="blue" />
          <KPICard label="Costos Fijos" value={fmtUSD(d.costosFijosSum)} icon="🏛️"
            sub="planilla, alquiler… (vigentes hoy)" color="red" />
          <KPICard label="Stock (valor costo)" value={fmtUSD(d.stockValor)} icon="📦"
            sub="inventario activo (hoy)" color="amber" />
        </div>

        {/* ── Salud Financiera ── */}
        <div className="res-section-label">🩺 Salud Financiera — {mesLabel}</div>
        <div className="res-kpi-grid">
          <KPICard label="Margen Neto del Mes" value={fmtPct(d.margenNetoPct)} icon="📐"
            sub="sobre ventas devengadas" color={d.margenNetoPct >= 0 ? 'green' : 'red'} />
          <KPICard label="Cobertura Costos Fijos" value={`${d.coberturaCostosFijos.toFixed(1)}×`} icon="🛡️"
            sub="veces que el mes los cubre" color={d.coberturaCostosFijos >= 1 ? 'teal' : 'amber'} />
          <KPICard label="Días de Cartera (CxC)" value={`${Math.round(d.diasCarteraCxC)} días`} icon="⏳"
            sub="DSO aprox. sobre venta diaria" color={d.diasCarteraCxC <= 30 ? 'blue' : 'amber'} />
          <KPICard label="% Cartera Vencida" value={fmtPct(d.pctCarteraVencida)} icon="🚨"
            sub="del total de CxC pendiente (hoy)" color={d.pctCarteraVencida === 0 ? 'green' : d.pctCarteraVencida < 20 ? 'amber' : 'red'} />
          <KPICard label="Posición Neta CxC − CPP" value={fmtUSD(d.posicionNetaCartera)} icon="🔀"
            sub={d.posicionNetaCartera >= 0 ? 'nos deben más de lo que debemos (hoy)' : 'debemos más de lo que nos deben (hoy)'}
            color={d.posicionNetaCartera >= 0 ? 'green' : 'red'} />
        </div>

        {/* ── Gráficas (client components) ── */}
        <div style={{ marginTop: '24px' }}>
          <DashboardChartsSection
            ventasPorMes={d.ventasPorMes}
            ventasSemana={d.ventasSemana as { fecha: string; monto: number; cobro: string }[]}
            gastosTotal={d.gastosTotal}
            costosFijosSum={d.costosFijosSum}
            mesLabel={mesLabel}
          />
        </div>

        {/* ── Panel de alertas unificado ── */}
        <AlertasPanel alertas={d.alertas} />

        {/* ── Estado de Resultados resumido ── */}
        <div className="card" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '18px' }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--txt)' }}>
              📊 Estado de Resultados — {mesLabel}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--txt3)' }}>base caja (cobrado)</div>
          </div>

          <div className="res-waterfall-row">
            <div className="res-waterfall-head">
              <span className="res-waterfall-label">Ingresos brutos</span>
              <span className="res-waterfall-value" style={{ color: 'var(--green)' }}>{fmtUSD(ingresos)}</span>
            </div>
            <div className="res-waterfall-track">
              <div className="res-waterfall-fill" style={{ width: '100%', background: 'var(--green)' }} />
            </div>
          </div>

          <div className="res-waterfall-row">
            <div className="res-waterfall-head">
              <span className="res-waterfall-label">Gastos operativos + costos fijos</span>
              <span className="res-waterfall-value" style={{ color: 'var(--red)' }}>{fmtUSD(gastos)}</span>
            </div>
            <div className="res-waterfall-track">
              <div className="res-waterfall-fill" style={{ width: `${gastosPct}%`, background: 'var(--red)' }} />
            </div>
          </div>

          <div className="res-waterfall-row">
            <div className="res-waterfall-head">
              <span className="res-waterfall-label">
                Utilidad neta est. <span style={{ color: 'var(--txt3)' }}>· {fmtPct(margenPct)} margen</span>
              </span>
              <span className="res-waterfall-value" style={{ color: utilidadEsPositiva ? 'var(--teal)' : 'var(--red)' }}>
                {fmtUSD(utilidad)}
              </span>
            </div>
            <div className="res-waterfall-track">
              <div className="res-waterfall-fill" style={{
                width: `${Math.max(0, Math.min(100, Math.abs(margenPct)))}%`,
                background: utilidadEsPositiva ? 'var(--teal)' : 'var(--red)',
              }} />
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

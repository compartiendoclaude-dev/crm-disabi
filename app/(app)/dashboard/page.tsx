import Topbar from '@/components/layout/Topbar'
import KPICard from '@/components/ui/KPICard'
import { getDashboardData } from '@/lib/dashboard-data'
import { fmtUSD, monthLabel } from '@/lib/utils'
import { DashboardChartsSection } from './DashboardChartsSection'
import AlertasPanel from '@/components/dashboard/AlertasPanel'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const d = await getDashboardData()

  const mesLabel = monthLabel(d.mesActual)

  return (
    <>
      <Topbar titulo="📊 Resumen Ejecutivo" />
      <div style={{ padding: '20px', maxWidth: '1400px' }}>

        {/* ── Fila 1: KPIs principales ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <KPICard label="Ventas del Mes" value={fmtUSD(d.ventasMesTotal)}
            sub={`${d.itemsMes} ventas cobradas · ${mesLabel}`} color="teal" />
          <KPICard label="Venta Semanal" value={fmtUSD(d.ventasSemTotal)}
            sub={`${d.itemsSem} ventas esta semana`} color="blue" />
          <KPICard label="Venta del Día" value={fmtUSD(d.ventasHoyTotal)}
            sub={`${d.itemsHoy} ventas hoy · ${d.hoy}`} color="green" />
          <KPICard label="CxC Pendiente" value={fmtUSD(d.cxcTotal)}
            sub={d.cxcVencido > 0 ? `⚠️ ${fmtUSD(d.cxcVencido)} vencido` : 'Sin vencidos'} color="amber" />
          <KPICard label="CPP Pendiente" value={fmtUSD(d.cppTotal)}
            sub="cuentas por pagar" color="red" />
          <KPICard label="Meta Anual" value={d.metaAnualPct.toFixed(1) + '%'}
            sub={`${fmtUSD(d.ventasAnoTotal)} de $200,000`} color="purple" />
        </div>

        {/* ── Fila 2: KPIs operativos ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          <KPICard label="Efectivo Hoy" value={fmtUSD(d.ventasHoyTotal)}
            sub="ventas cobradas hoy" color="green" />
          <KPICard label="Efectivo Semana" value={fmtUSD(d.ventasSemTotal)}
            sub="cobradas lun–hoy" color="teal" />
          <KPICard label="Neto Semana" value={fmtUSD(d.netoSemana)}
            sub="efectivo − gastos est." color="blue" />
          <KPICard label="Liquidación Pend." value={fmtUSD(d.liquidacionHoy)}
            sub="Link de Pago / POS hoy" color="purple" />
          <KPICard label="Ticket Promedio Mes" value={fmtUSD(d.ticketMes)}
            sub="por venta este mes" color="teal" />
          <KPICard label="Ticket Promedio Sem." value={fmtUSD(d.ticketSem)}
            sub="por venta esta semana" color="blue" />
          <KPICard label="Costos Fijos" value={fmtUSD(d.costosFijosSum)}
            sub="planilla, alquiler…" color="red" />
          <KPICard label="Stock (valor costo)" value={fmtUSD(d.stockValor)}
            sub="inventario activo" color="amber" />
        </div>

        {/* ── Gráficas (client components) ── */}
        <DashboardChartsSection
          ventasPorMes={d.ventasPorMes}
          ventasSemana={d.ventasSemana as { fecha: string; monto: number; cobro: string }[]}
          gastosTotal={d.gastosTotal}
          costosFijosSum={d.costosFijosSum}
          mesLabel={mesLabel}
        />

        {/* ── Panel de alertas unificado ── */}
        <AlertasPanel alertas={d.alertas} />

        {/* ── Estado de Resultados resumido ── */}
        <div className="card" style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--txt)', marginBottom: '14px' }}>
            📊 Estado de Resultados — {mesLabel}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Ingresos brutos</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmtUSD(d.ventasMesTotal)}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Gastos operativos</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{fmtUSD(d.gastosTotal + d.costosFijosSum)}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px' }}>Utilidad neta est.</div>
              <div style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: (d.ventasMesTotal - d.gastosTotal - d.costosFijosSum) >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                {fmtUSD(d.ventasMesTotal - d.gastosTotal - d.costosFijosSum)}
              </div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

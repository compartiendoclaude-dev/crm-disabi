'use client'
import { EstadoResultadosChart, VentasSemanaChart } from '@/components/charts/DashboardCharts'
import { fmtUSD } from '@/lib/utils'

interface Props {
  ventasPorMes: Record<string, { ventas: number; gastos: number; neto: number }>
  ventasSemana: { fecha: string; monto: number; cobro: string }[]
  gastosTotal: number
  costosFijosSum: number
  mesLabel: string
}

function getLunesStr(): string {
  const d = new Date()
  const dow = d.getDay()
  const lunes = new Date(d)
  lunes.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return lunes.toISOString().slice(0, 10)
}

export function DashboardChartsSection({ ventasPorMes, ventasSemana, gastosTotal, costosFijosSum, mesLabel }: Props) {
  const lunesStr = getLunesStr()

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '4px' }}>

      {/* Ventas de la semana */}
      <div className="card">
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--txt)', marginBottom: '12px' }}>
          📈 Ventas de la Semana
        </div>
        <VentasSemanaChart ventas={ventasSemana} lunesStr={lunesStr} />
      </div>

      {/* Resumen gastos vs ingresos */}
      <div className="card">
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--txt)', marginBottom: '12px' }}>
          ⚖️ Gastos vs Costos Fijos — {mesLabel}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '8px' }}>
          {[
            { label: 'Gastos variables', monto: gastosTotal, color: 'var(--amber)' },
            { label: 'Costos fijos', monto: costosFijosSum, color: 'var(--red)' },
            { label: 'Total egresos', monto: gastosTotal + costosFijosSum, color: 'var(--txt)', bold: true },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--bdr)' }}>
              <span style={{ fontSize: '12px', color: 'var(--txt2)' }}>{row.label}</span>
              <span style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', fontWeight: row.bold ? 800 : 600, color: row.color }}>
                {fmtUSD(row.monto)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Estado de Resultados últimos 6 meses */}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--txt)', marginBottom: '12px' }}>
          📊 Resultados Mensuales — últimos 6 meses
        </div>
        <EstadoResultadosChart ventasPorMes={ventasPorMes} />
      </div>

    </div>
  )
}

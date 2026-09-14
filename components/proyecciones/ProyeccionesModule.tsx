'use client'
import { useState } from 'react'
import MetasVentasPanel from './MetasVentasPanel'
import { fmtUSD, monthLabel } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts'

interface Props {
  ventasPorMes: number[]
  last6: string[]
  slope: number
  intercept: number
  ingDiario: number
  ingRef30: number
  gastosMes30: number
  cfSum: number
  gastosOpMes: number
  clientesNuevos30: number
  cxcProxMes: number
  cppProxMes: number
  proyVentas: (h: number) => number[]
  hoy: string
}

export default function ProyeccionesModule({ ventasPorMes, last6, slope, intercept, ingDiario, ingRef30, gastosMes30, cfSum, gastosOpMes, clientesNuevos30, cxcProxMes, cppProxMes, hoy }: Props) {
  const [horizonte, setHorizonte] = useState(1)

  // Proyectar próximos N meses con regresión lineal
  const n = ventasPorMes.length
  const proyVtas = Array.from({ length: horizonte }, (_, i) =>
    Math.max(0, intercept + slope * (n + i))
  )

  // Mes proyectado principal
  const proyVenta1    = proyVtas[0] ?? 0
  const margenBPct    = ingRef30 > 0 ? ((ingRef30 - gastosMes30) / ingRef30 * 100) : 0
  const proyUtilBruta = proyVenta1 * (margenBPct / 100)
  const proyUtilNeta  = proyUtilBruta - gastosOpMes
  const margenNPct    = proyVenta1 > 0 ? (proyUtilNeta / proyVenta1 * 100) : 0
  const proyFlujo     = proyVenta1 + cxcProxMes - cppProxMes - cfSum

  // Datos para gráfica: histórico + proyección
  const now = new Date(hoy)
  const chartData = [
    ...last6.map((m, i) => ({
      mes: monthLabel(m),
      historico: parseFloat(ventasPorMes[i].toFixed(2)),
      proyectado: null,
    })),
    ...proyVtas.map((v, i) => {
      const d = new Date(now)
      d.setMonth(d.getMonth() + i + 1)
      d.setDate(1)
      return {
        mes: monthLabel(d.toISOString().slice(0, 7)),
        historico: null,
        proyectado: parseFloat(v.toFixed(2)),
      }
    }),
  ]

  // Gráfica márgenes proyectados
  const margenesData = proyVtas.map((v, i) => {
    const d = new Date(now); d.setMonth(d.getMonth() + i + 1); d.setDate(1)
    const utilBruta = v * (margenBPct / 100)
    const utilNeta  = utilBruta - gastosOpMes
    return {
      mes: monthLabel(d.toISOString().slice(0, 7)),
      margenBruto: parseFloat(Math.max(0, v > 0 ? (utilBruta / v * 100) : 0).toFixed(1)),
      margenNeto:  parseFloat((v > 0 ? (utilNeta / v * 100) : 0).toFixed(1)),
    }
  })

  return (
    <div style={{ padding: 20 }}>
      {/* Advertencia metodología */}
      <div style={{ background: 'rgba(8,145,178,.08)', border: '1px solid rgba(8,145,178,.25)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 16, fontSize: 11, color: 'var(--teal)', display: 'flex', gap: 8 }}>
        <span>📊</span>
        <span>Proyecciones calculadas con promedio ponderado de los últimos 30 días + regresión lineal de 6 meses. Son estimaciones orientativas, no garantías. A mayor historial, mayor precisión.</span>
      </div>

      {/* Selector horizonte */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: 'var(--txt3)' }}>Horizonte:</span>
        {[1, 3, 6].map(h => (
          <button key={h} className={`btn ${horizonte === h ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setHorizonte(h)}>
            {h === 1 ? 'Próximo mes' : `Próximos ${h} meses`}
          </button>
        ))}
      </div>

      {/* KPIs proyectados */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Ventas Proyectadas',        value: fmtUSD(proyVenta1),                 sub: `Base: ${fmtUSD(ingDiario)}/día × 30`,                            color: 'var(--teal)',   trend: slope >= 0 ? `▲ ${fmtUSD(Math.abs(slope))}/mes` : `▼ ${fmtUSD(Math.abs(slope))}/mes`, trendUp: slope >= 0 },
          { label: 'Clientes Nuevos Proy.',     value: String(clientesNuevos30),             sub: `${clientesNuevos30} en últimos 30d`,                              color: 'var(--green)'  },
          { label: 'Flujo Neto Proyectado',     value: fmtUSD(proyFlujo),                   sub: 'ventas + CxC − CPP − CF',                                        color: proyFlujo >= 0 ? 'var(--blue)' : 'var(--red)' },
          { label: 'Margen Bruto Proyectado',   value: margenBPct.toFixed(1) + '%',          sub: 'sobre ventas proyectadas',                                       color: 'var(--green)'  },
          { label: 'Margen Neto Proyectado',    value: margenNPct.toFixed(1) + '%',          sub: 'después de gastos operativos',                                   color: 'var(--purple)' },
          { label: 'Gastos Operativos Proy.',   value: fmtUSD(gastosOpMes),                  sub: `var: ${fmtUSD(gastosMes30)} + fijos: ${fmtUSD(cfSum)}`,         color: 'var(--amber)'  },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 18 }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
            {k.trend && <div style={{ fontSize: 10, marginTop: 3, fontWeight: 700, color: k.trendUp ? 'var(--green)' : 'var(--red)' }}>{k.trend}</div>}
          </div>
        ))}
      </div>

      {/* Gráfica principal: histórico + proyección */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>📈 Tendencia y Proyección de Ventas</div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
            <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6b7280' }} />
            <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
            <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => ['$' + v.toFixed(2)]} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="historico"  name="Histórico"   stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="proyectado" name="Proyectado"  stroke="#16a34a" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Gráficas secundarias */}
      {horizonte > 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>💰 Márgenes Proyectados (%)</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={margenesData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} unit="%" />
                <Tooltip contentStyle={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [v.toFixed(1) + '%']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="margenBruto" name="Margen Bruto" fill="#16a34a" radius={[3, 3, 0, 0]} />
                <Bar dataKey="margenNeto"  name="Margen Neto"  fill="#7c3aed" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>🧮 Supuestos de la Proyección</div>
            {[
              { label: 'Ingreso diario base (30d)', value: fmtUSD(ingDiario) },
              { label: 'Tendencia mensual (regresión)', value: (slope >= 0 ? '+' : '') + fmtUSD(slope) + '/mes' },
              { label: 'Gastos variables (30d)', value: fmtUSD(gastosMes30) },
              { label: 'Costos fijos mensuales', value: fmtUSD(cfSum) },
              { label: 'CxC próximo mes', value: fmtUSD(cxcProxMes) },
              { label: 'CPP próximo mes', value: fmtUSD(cppProxMes) },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '6px 0', borderBottom: '1px solid var(--bdr)' }}>
                <span style={{ color: 'var(--txt2)' }}>{s.label}</span>
                <span className="mono" style={{ fontWeight: 600 }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Metas de Ventas ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>🎯 Metas de Ventas</div>
        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 16 }}>
          Define metas por período y vendedor. El sistema las compara automáticamente contra las ventas reales cobradas.
        </div>
        <MetasVentasPanel />
      </div>

    </div>
  )
}

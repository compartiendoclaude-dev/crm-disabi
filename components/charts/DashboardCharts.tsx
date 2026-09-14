'use client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import { monthLabel } from '@/lib/utils'

// ── Gráfica de ventas por mes (Estado de Resultados) ────────────────────────
interface MesData {
  mes: string
  ventas: number
  gastos: number
  neto: number
}

interface EstadoResultadosChartProps {
  ventasPorMes: Record<string, { ventas: number; gastos: number; neto: number }>
}

export function EstadoResultadosChart({ ventasPorMes }: EstadoResultadosChartProps) {
  const data: MesData[] = Object.entries(ventasPorMes)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([mes, v]) => ({
      mes: monthLabel(mes),
      ventas: parseFloat(v.ventas.toFixed(2)),
      gastos: parseFloat(v.gastos.toFixed(2)),
      neto:   parseFloat(v.neto.toFixed(2)),
    }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
        <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#6b7280' }} />
        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'k'} />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => ['$' + v.toFixed(2)]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="ventas" name="Ventas" fill="#0891b2" radius={[3,3,0,0]} />
        <Bar dataKey="gastos" name="Gastos" fill="#dc2626" radius={[3,3,0,0]} />
        <Bar dataKey="neto"   name="Neto"   fill="#16a34a" radius={[3,3,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Gráfica de ventas de la semana (línea diaria) ────────────────────────────
interface VentaDia { fecha: string; monto: number; cobro: string }

interface VentasSemanaChartProps {
  ventas: VentaDia[]
  lunesStr: string
}

export function VentasSemanaChart({ ventas, lunesStr }: VentasSemanaChartProps) {
  const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
  const data = dias.map((dia, i) => {
    const d = new Date(lunesStr)
    d.setDate(d.getDate() + i)
    const fecha = d.toISOString().slice(0, 10)
    const total = ventas
      .filter(v => v.fecha === fecha && v.cobro === 'Cobrado')
      .reduce((a, v) => a + v.monto, 0)
    return { dia, total: parseFloat(total.toFixed(2)) }
  })

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
        <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#6b7280' }} />
        <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => '$' + v} />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number) => ['$' + v.toFixed(2), 'Ventas']}
        />
        <Line type="monotone" dataKey="total" stroke="#0891b2" strokeWidth={2} dot={{ r: 3, fill: '#0891b2' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

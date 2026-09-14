import type { CSSProperties } from 'react'

interface KPICardProps {
  label: string
  value: string
  sub?: string
  trend?: string
  trendUp?: boolean
  color?: 'teal' | 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'indigo'
  icon?: string
  /** 0–100: si se pasa, dibuja una barra de progreso debajo del valor (ej. Meta Anual) */
  progress?: number
}

const COLOR_MAP: Record<string, string> = {
  teal:   'var(--teal)',
  green:  'var(--green)',
  amber:  'var(--amber)',
  red:    'var(--red)',
  blue:   'var(--blue)',
  purple: 'var(--purple)',
  indigo: 'var(--indigo)',
}

export default function KPICard({ label, value, sub, trend, trendUp, color = 'teal', icon, progress }: KPICardProps) {
  const c = COLOR_MAP[color]

  return (
    <div className="res-kpi" style={{ '--kpi-c': c } as CSSProperties}>
      <div className="res-kpi__top">
        <div className="res-kpi__label">{label}</div>
        {icon && <span className="res-kpi__icon">{icon}</span>}
      </div>

      <div className="res-kpi__value" style={{ color: c }}>{value}</div>

      {sub && <div className="res-kpi__sub">{sub}</div>}

      {typeof progress === 'number' && (
        <div className="res-kpi__progress">
          <div className="res-kpi__progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}

      {trend && (
        <div className="res-kpi__trend" style={{
          color: trendUp === undefined ? 'var(--txt3)' : trendUp ? 'var(--green)' : 'var(--red)',
          background: trendUp === undefined ? 'var(--surf2)' : trendUp ? 'rgba(22,163,74,.1)' : 'rgba(220,38,38,.1)',
        }}>
          {trendUp === true ? '▲' : trendUp === false ? '▼' : '–'} {trend}
        </div>
      )}
    </div>
  )
}

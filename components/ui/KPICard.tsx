interface KPICardProps {
  label: string
  value: string
  sub?: string
  trend?: string
  trendUp?: boolean
  color?: 'teal' | 'green' | 'amber' | 'red' | 'blue' | 'purple'
  borderTop?: boolean
}

const COLOR_MAP: Record<string, string> = {
  teal:   'var(--teal)',
  green:  'var(--green)',
  amber:  'var(--amber)',
  red:    'var(--red)',
  blue:   'var(--blue)',
  purple: 'var(--purple)',
}

export default function KPICard({ label, value, sub, trend, trendUp, color = 'teal', borderTop = true }: KPICardProps) {
  const c = COLOR_MAP[color]
  return (
    <div className="kpi-card" style={{ borderTop: borderTop ? `3px solid ${c}` : undefined }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: c }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--txt3)', marginTop: '3px' }}>{sub}</div>}
      {trend && (
        <div style={{
          fontSize: '10px',
          marginTop: '4px',
          color: trendUp === undefined ? 'var(--txt3)' : trendUp ? 'var(--green)' : 'var(--red)',
          fontWeight: 600,
        }}>
          {trendUp === true ? '▲' : trendUp === false ? '▼' : '–'} {trend}
        </div>
      )}
    </div>
  )
}

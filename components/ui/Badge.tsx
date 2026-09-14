type BadgeColor = 'green' | 'amber' | 'red' | 'gray' | 'purple' | 'teal' | 'blue'

interface BadgeProps { label: string; color?: BadgeColor }

export default function Badge({ label, color = 'gray' }: BadgeProps) {
  return <span className={`badge badge-${color}`}>{label}</span>
}

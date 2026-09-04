'use client'

interface TopbarProps { titulo: string; subtitulo?: string }

export default function Topbar({ titulo, subtitulo }: TopbarProps) {
  const hoy = new Date().toLocaleDateString('es-SV', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <header style={{
      background: 'var(--surf)',
      borderBottom: '1px solid var(--bdr)',
      padding: '20px 28px 16px',
      position: 'sticky',
      top: 0,
      zIndex: 40,
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--txt)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
            {titulo}
          </h1>
          {subtitulo && (
            <div style={{ fontSize: '12px', color: 'var(--txt3)', marginTop: '3px' }}>
              {subtitulo}
            </div>
          )}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'var(--surf2)', border: '1px solid var(--bdr)',
          borderRadius: '8px', padding: '6px 12px',
          fontSize: '12px', color: 'var(--txt2)', fontWeight: 500,
        }}>
          📅 {hoy}
        </div>
      </div>
    </header>
  )
}

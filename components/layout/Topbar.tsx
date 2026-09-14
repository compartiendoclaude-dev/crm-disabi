'use client'
import { useSidebar } from './SidebarContext'

interface TopbarProps { titulo: string; subtitulo?: string }

export default function Topbar({ titulo, subtitulo }: TopbarProps) {
  const { toggle } = useSidebar()
  const hoy = new Date().toLocaleDateString('es-SV', {
    day: 'numeric', month: 'long', year: 'numeric'
  })

  return (
    <header style={{
      background: 'var(--surf)',
      borderBottom: '1px solid var(--bdr)',
      padding: '16px 16px 14px',
      position: 'sticky',
      top: 0,
      zIndex: 40,
      boxShadow: '0 1px 3px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <button
            onClick={toggle}
            className="hamburger-btn"
            aria-label="Abrir menú"
            style={{
              display: 'none',
              flexShrink: 0,
              width: '36px', height: '36px',
              background: 'var(--surf2)', border: '1px solid var(--bdr)',
              borderRadius: '8px', cursor: 'pointer',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '16px', color: 'var(--txt)',
              marginTop: '2px',
            }}
          >
            ☰
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              fontSize: '20px', fontWeight: 800, color: 'var(--txt)',
              letterSpacing: '-0.3px', lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {titulo}
            </h1>
            {subtitulo && (
              <div style={{ fontSize: '12px', color: 'var(--txt3)', marginTop: '3px' }}>
                {subtitulo}
              </div>
            )}
          </div>
        </div>
        <div
          className="topbar-date"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'var(--surf2)', border: '1px solid var(--bdr)',
            borderRadius: '8px', padding: '6px 12px',
            fontSize: '12px', color: 'var(--txt2)', fontWeight: 500,
            flexShrink: 0, whiteSpace: 'nowrap',
          }}
        >
          📅 {hoy}
        </div>
      </div>
    </header>
  )
}

'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { NAV_ITEMS, PERMISOS } from '@/lib/constants'
import { createClient } from '@/lib/supabase'
import type { Rol } from '@/lib/types'

interface SidebarProps { rol: Rol; nombre: string }

export default function Sidebar({ rol, nombre }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const permisos = PERMISOS[rol]
  const sb       = createClient()

  async function handleLogout() {
    await sb.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside style={{
      position: 'fixed',
      top: 0, left: 0, bottom: 0,
      width: 'var(--sidebar-w)',
      background: 'var(--sidebar-bg)',
      borderRight: '1px solid var(--sidebar-bdr)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 50,
      overflowY: 'auto',
    }}>

      {/* Logo — estilo DataVisual SV */}
      <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid var(--sidebar-bdr)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span style={{ fontSize: '18px', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            DISABI
          </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--indigo)' }}>
            ERP
          </span>
        </div>
        <div style={{ fontSize: '10px', color: 'var(--sidebar-txt2)', marginTop: '3px', letterSpacing: '.4px' }}>
          Sistema Operativo
        </div>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {NAV_ITEMS.map(item => {
          const perm     = permisos[item.modulo]
          if (perm === false) return null
          const isActive = pathname.startsWith('/' + item.modulo)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive ? '#fff' : 'var(--sidebar-txt)',
                background: isActive ? 'var(--sidebar-act)' : 'transparent',
                textDecoration: 'none',
                marginBottom: '2px',
                transition: 'background .15s, color .15s',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)' }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              <span style={{ fontSize: '15px', width: '18px', textAlign: 'center', opacity: isActive ? 1 : .7 }}>
                {item.icon}
              </span>
              {item.label}
              {perm === 'read' && (
                <span style={{
                  marginLeft: 'auto', fontSize: '9px',
                  color: 'var(--sidebar-txt2)',
                  background: 'rgba(255,255,255,.07)',
                  padding: '1px 6px', borderRadius: '4px',
                }}>
                  VER
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Usuario + Cerrar sesión */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--sidebar-bdr)' }}>
        <div style={{ padding: '8px 14px', marginBottom: '4px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>{nombre}</div>
          <div style={{ fontSize: '10px', color: 'var(--sidebar-txt2)', textTransform: 'uppercase', letterSpacing: '.4px', marginTop: '2px' }}>
            {rol}
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            width: '100%', padding: '9px 14px',
            borderRadius: '8px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontSize: '13px', color: 'var(--sidebar-txt)',
            fontFamily: 'var(--font-body)',
            transition: 'background .15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.06)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          <span style={{ fontSize: '15px', width: '18px', textAlign: 'center', opacity: .7 }}>🚪</span>
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}

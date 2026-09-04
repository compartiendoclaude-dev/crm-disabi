'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NAV_ITEMS, PERMISOS } from '@/lib/constants'
import type { Rol } from '@/lib/types'

export default function MobileNav({ rol }: { rol: Rol }) {
  const pathname = usePathname()
  const permisos = PERMISOS[rol]
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // No renderizar en desktop
  if (!isMobile) return null

  const visible = NAV_ITEMS.filter(i => permisos[i.modulo] !== false).slice(0, 5)

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      height: '64px',
      background: 'var(--surf)',
      borderTop: '1px solid var(--bdr)',
      display: 'flex',
      zIndex: 50,
    }}>
      {visible.map(item => {
        const isActive = pathname.startsWith('/' + item.modulo)
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              color: isActive ? 'var(--teal)' : 'var(--txt3)',
              textDecoration: 'none',
              fontSize: '9px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.3px',
            }}
          >
            <span style={{ fontSize: '20px' }}>{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

'use client'
import { createContext, useContext, useState, useEffect } from 'react'

interface SidebarCtx {
  open: boolean
  toggle: () => void
  close: () => void
}

const Ctx = createContext<SidebarCtx>({ open: false, toggle: () => {}, close: () => {} })

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  // Cerrar automáticamente al cambiar de tamaño a desktop
  useEffect(() => {
    const check = () => { if (window.innerWidth >= 900) setOpen(false) }
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen(o => !o), close: () => setOpen(false) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSidebar() { return useContext(Ctx) }

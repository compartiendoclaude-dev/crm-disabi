import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import Sidebar from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import { USUARIOS_SISTEMA } from '@/lib/constants'
import type { Rol } from '@/lib/types'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sb = await createClient()

  // Verificar sesión en servidor
  const { data: { user } } = await sb.auth.getUser()
  if (!user) redirect('/login')

  // Leer rol desde disabi_usuarios (tabla Supabase)
  const { data: usuario } = await sb
    .from('disabi_usuarios')
    .select('nombre, rol')
    .eq('user_id', user.id)
    .single()

  // Fallback: buscar en USUARIOS_SISTEMA por email (para antes de correr el SQL)
  const sistemaUser = USUARIOS_SISTEMA.find(u => u.email === user.email)
  const rol: Rol    = (usuario?.rol as Rol) ?? sistemaUser?.rol ?? 'ventas'
  const nombre: string = usuario?.nombre ?? sistemaUser?.nombre ?? user.email ?? 'Usuario'

  return (
    <div className="app-shell">
      {/* Sidebar — oculto en mobile */}
      <div style={{ display: 'none' }} className="sidebar-wrapper">
        <Sidebar rol={rol} nombre={nombre} />
      </div>
      <Sidebar rol={rol} nombre={nombre} />

      {/* Contenido principal */}
      <main className="main-content">
        {children}
      </main>

      {/* Nav inferior mobile */}
      <MobileNav rol={rol} />
    </div>
  )
}

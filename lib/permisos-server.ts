import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { PERMISOS, PERMISOS_EXTRA } from '@/lib/constants'
import type { Rol } from '@/lib/types'

// ── Control de acceso por rol — lado servidor ────────────────────────────────
// Hasta ahora el `rol` de disabi_usuarios solo se usaba en el navegador para
// decidir qué botones mostrar. Ni las páginas (Server Components) ni los
// endpoints de escritura verificaban nada — cualquier usuario autenticado
// podía ver/mutar cualquier módulo sin importar su rol, entrando directo por
// la URL o llamando al API. Estas dos funciones cierran ese hueco reusando
// el mismo PERMISOS de lib/constants.ts (una sola fuente de verdad).

async function getRolActual(): Promise<{ userId: string; rol: Rol | null } | null> {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null

  const { data } = await sb
    .from('disabi_usuarios')
    .select('rol')
    .eq('user_id', user.id)
    .single()

  return { userId: user.id, rol: (data?.rol ?? null) as Rol | null }
}

// ── Para Server Components (páginas) ─────────────────────────────────────────
// Si el rol no tiene ningún acceso al módulo (permiso === false o sin rol
// asignado), redirige a /dashboard. Si el permiso es 'read' o true, deja
// pasar (la página se muestra; las acciones de escritura se controlan aparte
// con requirePermisoEscritura en el endpoint correspondiente).
export async function requirePermisoPagina(modulo: keyof (typeof PERMISOS)['admin']) {
  const actual = await getRolActual()
  if (!actual) redirect('/login')

  const permiso = actual.rol ? PERMISOS[actual.rol]?.[modulo] : undefined
  if (!permiso) redirect('/dashboard')

  return { rol: actual.rol as Rol, permiso }
}

async function permisoDe(userId: string, modulo: keyof (typeof PERMISOS)['admin']) {
  const sb = await createClient()
  const { data } = await sb
    .from('disabi_usuarios')
    .select('rol')
    .eq('user_id', userId)
    .single()

  const rol = (data?.rol ?? null) as Rol | null
  return rol ? PERMISOS[rol]?.[modulo] : undefined
}

// ── Para rutas API que escriben (POST/PUT/DELETE) ────────────────────────────
// Solo permiso === true habilita escritura — 'read' (ej. socio, o finanzas en
// algunos módulos) puede ver pero no debe poder mutar datos.
export async function requirePermisoEscritura(
  userId: string,
  modulo: keyof (typeof PERMISOS)['admin']
): Promise<boolean> {
  return (await permisoDe(userId, modulo)) === true
}

// ── Para rutas API de solo lectura (GET) ─────────────────────────────────────
// true o 'read' habilitan ver los datos; false (o sin rol) no.
export async function requirePermisoLectura(
  userId: string,
  modulo: keyof (typeof PERMISOS)['admin']
): Promise<boolean> {
  return !!(await permisoDe(userId, modulo))
}

// ── Permiso angosto (ver PERMISOS_EXTRA en lib/constants.ts) ────────────────
// Para una acción puntual que un rol necesita sin tener el módulo completo —
// por ejemplo Ventas subiendo el DTE de su propia venta, o registrando un
// gasto operativo variable, sin acceso al módulo Finanzas ni DTE completos.
export async function tienePermisoExtra(userId: string, flag: string): Promise<boolean> {
  const sb = await createClient()
  const { data } = await sb
    .from('disabi_usuarios')
    .select('rol')
    .eq('user_id', userId)
    .single()

  const rol = (data?.rol ?? null) as Rol | null
  if (!rol) return false
  return !!PERMISOS_EXTRA[rol]?.[flag]
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// ── Rate limit centralizado por IP ────────────────────────────────────────────
// Cada ruta mantiene su propio Map para evitar que una ruta contamine otra.
// Límites diferenciados por sensibilidad:
//   - rutas normales:    60 req/min
//   - rutas sensibles:   20 req/min (auditoría, DTE, conciliación)
//   - portal (público):  20 req/min (ya en portal-cliente/route.ts)

export function makeRateLimiter(maxPerMinute: number) {
  const hits = new Map<string, number[]>()
  return function rateLimit(ip: string): boolean {
    const now  = Date.now()
    const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
    prev.push(now)
    hits.set(ip, prev)
    return prev.length <= maxPerMinute
  }
}

// ── Respuesta estándar de rate limit ─────────────────────────────────────────
export function rateLimitResponse() {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta en un minuto.' },
    { status: 429 }
  )
}

// ── Respuesta estándar de no autorizado ──────────────────────────────────────
export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'No autorizado' },
    { status: 401 }
  )
}

// ── Obtener usuario autenticado desde la sesión ───────────────────────────────
// Siempre usa getUser() server-side — nunca confía en el cliente.
export async function getAuthUser() {
  try {
    const sb = await createClient()
    const { data: { user }, error } = await sb.auth.getUser()
    if (error || !user) return null
    return user
  } catch {
    return null
  }
}

// ── Guard completo: rate limit + auth en una línea ────────────────────────────
// Uso: const guard = await requireAuth(req, rateLimiter)
//      if (guard.error) return guard.error
//      const user = guard.user  (garantizado non-null)
export async function requireAuth(
  req: NextRequest,
  rateLimiter: (ip: string) => boolean
): Promise<{ error: NextResponse; user: null } | { error: null; user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>> }> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'

  if (!rateLimiter(ip)) {
    return { error: rateLimitResponse(), user: null }
  }

  const user = await getAuthUser()
  if (!user) {
    return { error: unauthorizedResponse(), user: null }
  }

  return { error: null, user }
}

// ── Obtener rol del usuario desde disabi_usuarios ─────────────────────────────
export async function getUserRole(userId: string): Promise<string | null> {
  try {
    const sb = await createClient()
    const { data } = await sb
      .from('disabi_usuarios')
      .select('rol')
      .eq('user_id', userId)
      .single()
    return data?.rol ?? null
  } catch {
    return null
  }
}

// ── Guard solo para admins ────────────────────────────────────────────────────
export async function requireAdmin(
  req: NextRequest,
  rateLimiter: (ip: string) => boolean
): Promise<{ error: NextResponse; user: null; rol: null } | { error: null; user: NonNullable<Awaited<ReturnType<typeof getAuthUser>>>; rol: string }> {
  const guard = await requireAuth(req, rateLimiter)
  if (guard.error) return { error: guard.error, user: null, rol: null }

  const rol = await getUserRole(guard.user.id)
  if (rol !== 'admin') {
    return {
      error: NextResponse.json({ error: 'Acceso restringido a administradores' }, { status: 403 }),
      user: null, rol: null,
    }
  }

  return { error: null, user: guard.user, rol }
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(20) // sensible — solo admins

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb  = await createClient()
    const url = new URL(req.url)

    const tabla     = url.searchParams.get('tabla')     ?? ''
    const operacion = url.searchParams.get('operacion') ?? ''
    const usuario   = url.searchParams.get('usuario')   ?? ''
    const desde     = url.searchParams.get('desde')     ?? ''
    const hasta     = url.searchParams.get('hasta')     ?? ''
    const page      = parseInt(url.searchParams.get('page') ?? '1')
    const limit     = 50

    let q = sb.from('disabi_auditoria')
      .select('id, tabla, operacion, registro_id, usuario_email, datos_antes, datos_despues, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (tabla)     q = q.eq('tabla', tabla)
    if (operacion) q = q.eq('operacion', operacion)
    if (usuario)   q = q.ilike('usuario_email', `%${usuario}%`)
    if (desde)     q = q.gte('created_at', desde + 'T00:00:00')
    if (hasta)     q = q.lte('created_at', hasta + 'T23:59:59')

    const { data, count, error } = await q
    if (error) throw error

    // Resumen de tablas afectadas (para filtros)
    const { data: tablas } = await sb.from('disabi_auditoria')
      .select('tabla')
      .order('tabla')

    const tablasUnicas = Array.from(new Set((tablas ?? []).map(t => t.tabla))).sort()

    return NextResponse.json({
      ok: true,
      registros: data ?? [],
      total: count ?? 0,
      page, limit,
      tablas: tablasUnicas,
    })
  } catch (e: unknown) {
    console.error('[api/auditoria]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

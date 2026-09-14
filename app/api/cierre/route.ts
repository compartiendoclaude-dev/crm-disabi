import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requirePermisoEscritura, requirePermisoLectura } from '@/lib/permisos-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

// ── Cierre mensual ────────────────────────────────────────────────────────────
// Cerrar un mes bloquea la creación/edición de movimientos con fecha dentro de
// ese período en todos los módulos (ventas, gastos, CxC, CPP, planilla,
// comisiones, costos fijos, compras, devoluciones). Reabrir un mes quita ese
// bloqueo — solo pensado para corregir un error, no para uso rutinario.

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoLectura(user.id, 'finanzas')))
    return NextResponse.json({ error: 'Tu rol no tiene acceso a Finanzas' }, { status: 403 })

  const { data, error } = await sb.from('disabi_cierres_mensuales')
    .select('*').order('periodo', { ascending: false })
  if (error) return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })

  return NextResponse.json({ ok: true, cierres: data ?? [] })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoEscritura(user.id, 'finanzas')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para cerrar o reabrir períodos' }, { status: 403 })

  const body = await req.json()
  const { action } = body

  try {
    if (action === 'cerrar_mes') {
      const { periodo, notas } = body
      if (!periodo || !/^\d{4}-\d{2}$/.test(periodo))
        return NextResponse.json({ error: 'Período inválido. Formato esperado: YYYY-MM' }, { status: 400 })

      const { error } = await sb.from('disabi_cierres_mensuales')
        .insert([{ periodo, cerrado_por: user.id, notas: notas || null }])
      if (error) {
        if (error.code === '23505')
          return NextResponse.json({ error: `El período ${periodo} ya estaba cerrado.` }, { status: 400 })
        throw error
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'reabrir_mes') {
      const { periodo } = body
      if (!periodo || !/^\d{4}-\d{2}$/.test(periodo))
        return NextResponse.json({ error: 'Período inválido. Formato esperado: YYYY-MM' }, { status: 400 })

      const { error } = await sb.from('disabi_cierres_mensuales').delete().eq('periodo', periodo)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/cierre]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

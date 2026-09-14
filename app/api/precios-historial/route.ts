import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(60)

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb  = await createClient()
    const url = new URL(req.url)
    const producto_id = url.searchParams.get('producto_id')
    const limit = parseInt(url.searchParams.get('limit') ?? '50')

    let q = sb.from('disabi_precios_historial')
      .select('*, producto:disabi_productos(nombre, codigo, precio_venta, costo_unitario)')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (producto_id) q = q.eq('producto_id', producto_id)

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ ok: true, historial: data ?? [] })
  } catch (e: unknown) {
    console.error('[api/precios-historial GET]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb   = await createClient()
    const body = await req.json()
    const { action } = body

    // Registrar cambio de precio manualmente (con motivo)
    if (action === 'registrar_motivo') {
      const { historial_id, motivo } = body
      const { error } = await sb.from('disabi_precios_historial')
        .update({ motivo }).eq('id', historial_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/precios-historial POST]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

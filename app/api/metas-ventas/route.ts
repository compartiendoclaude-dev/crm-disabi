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
    const periodo = url.searchParams.get('periodo') ?? new Date().toISOString().slice(0, 7)

    const [
      { data: metas },
      { data: empleados },
      { data: ventas },
    ] = await Promise.all([
      // Metas del período + 6 meses atrás para contexto
      sb.from('disabi_metas_ventas')
        .select('*, vendedor:disabi_empleados(nombre, cargo)')
        .order('periodo', { ascending: false })
        .limit(50),

      sb.from('disabi_empleados')
        .select('id, nombre, cargo, tipo_contrato, activo')
        .eq('activo', true)
        .order('nombre'),

      // Ventas cobradas del período por vendedor
      sb.from('disabi_ventas')
        .select('monto, vendedor_id, fecha, cobro')
        .gte('fecha', periodo + '-01')
        .lte('fecha', periodo + '-31')
        .neq('cobro', 'Borrador'),
    ])

    const vts = ventas ?? []
    const mts = metas ?? []

    // Real por vendedor en el período
    const realPorVendedor: Record<string, number> = {}
    let realGlobal = 0
    vts.forEach(v => {
      const monto = v.cobro === 'Cobrado' ? (v.monto ?? 0) : 0
      realGlobal += monto
      if (v.vendedor_id) {
        realPorVendedor[v.vendedor_id] = (realPorVendedor[v.vendedor_id] ?? 0) + monto
      }
    })

    // Meta global del período
    const metaGlobal = mts.find(m => m.periodo === periodo && !m.vendedor_id)

    // Combinar metas con real
    const metasPeriodo = mts
      .filter(m => m.periodo === periodo)
      .map(m => ({
        ...m,
        real: m.vendedor_id ? (realPorVendedor[m.vendedor_id] ?? 0) : realGlobal,
        pct:  m.meta_monto > 0
          ? Math.round((m.vendedor_id ? (realPorVendedor[m.vendedor_id] ?? 0) : realGlobal) / m.meta_monto * 100)
          : 0,
      }))

    return NextResponse.json({
      ok: true,
      periodo,
      metas: mts,
      metasPeriodo,
      empleados: empleados ?? [],
      realGlobal,
      metaGlobal,
      realPorVendedor,
    })
  } catch (e: unknown) {
    console.error('[api/metas-ventas GET]', e)
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

    if (action === 'save_meta') {
      const { id, periodo, vendedor_id, meta_monto, meta_unidades, notas } = body

      if (!periodo || !meta_monto)
        return NextResponse.json({ error: 'Período y meta requeridos' }, { status: 400 })

      const obj = {
        periodo,
        vendedor_id: vendedor_id || null,
        meta_monto:  parseFloat(meta_monto),
        meta_unidades: meta_unidades ? parseInt(meta_unidades) : null,
        notas: notas || null,
      }

      if (id) {
        const { error } = await sb.from('disabi_metas_ventas').update(obj).eq('id', id)
        if (error) throw error
      } else {
        const { error } = await sb.from('disabi_metas_ventas')
          .upsert([obj], { onConflict: 'periodo,vendedor_id' })
        if (error) throw error
      }

      return NextResponse.json({ ok: true })
    }

    if (action === 'delete_meta') {
      const { id } = body
      const { error } = await sb.from('disabi_metas_ventas').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/metas-ventas POST]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

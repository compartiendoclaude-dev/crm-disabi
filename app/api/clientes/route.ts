import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { today } from '@/lib/utils'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  try {
    if (action === 'save_cliente') {
      const { editId, nombre, contacto, email, telefono, sector, direccion, pais, limiteCredito, notas } = body
      if (!nombre?.trim()) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

      const obj = {
        nombre: nombre.trim(), contacto: contacto || null, email: email || null,
        telefono: telefono || null, sector: sector || null,
        direccion: direccion || null,
        pais: pais || 'El Salvador',
        limite_credito: limiteCredito ?? 0,
        notas: notas || null,
      }

      if (editId) {
        const { error } = await sb.from('disabi_clientes').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_clientes')
          .insert([{ ...obj, fecha_registro: today() }]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    if (action === 'delete_cliente') {
      const { id } = body
      const { error } = await sb.from('disabi_clientes').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/clientes]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

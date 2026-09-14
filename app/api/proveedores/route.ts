import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requirePermisoEscritura } from '@/lib/permisos-server'

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

  // Hallazgo #7 (evaluación CPP): Proveedores (maestro, incluye limite_credito y
  // dias_credito usados en el hallazgo #3) tampoco verificaba el rol, solo la sesión.
  // El módulo de Proveedores vive dentro de la pestaña "Proveedores" de Compras, así
  // que reusa el mismo permiso 'compras' del PERMISOS de lib/constants.ts.
  if (!(await requirePermisoEscritura(user.id, 'compras')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar Proveedores' }, { status: 403 })

  const body = await req.json()
  const { action } = body

  try {
    if (action === 'save_proveedor') {
      const {
        editId, nombre, razon_social, nit, nrc, contacto, email,
        telefono, pais, direccion, tipo, moneda, dias_credito,
        limite_credito, notas, activo,
      } = body

      if (!nombre?.trim())
        return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

      const obj = {
        nombre: nombre.trim(),
        razon_social: razon_social || null,
        nit:          nit          || null,
        nrc:          nrc          || null,
        contacto:     contacto     || null,
        email:        email        || null,
        telefono:     telefono     || null,
        pais:         pais         || 'El Salvador',
        direccion:    direccion    || null,
        tipo:         tipo         || 'local',
        moneda:       moneda       || 'USD',
        dias_credito: parseInt(dias_credito)   || 0,
        limite_credito: parseFloat(limite_credito) || 0,
        notas:        notas        || null,
        activo:       activo !== false,
      }

      if (editId) {
        const { error } = await sb.from('disabi_proveedores').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_proveedores').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    if (action === 'delete_proveedor') {
      const { id } = body
      // Soft delete — no eliminar si tiene compras asociadas
      const { count } = await sb.from('disabi_compras')
        .select('*', { count: 'exact', head: true })
        .eq('proveedor_id', id)
      if ((count ?? 0) > 0) {
        const { error } = await sb.from('disabi_proveedores').update({ activo: false }).eq('id', id)
        if (error) throw error
        return NextResponse.json({ ok: true, soft: true, msg: 'Proveedor desactivado (tiene compras vinculadas)' })
      }
      const { error } = await sb.from('disabi_proveedores').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // Vincular una compra existente a un proveedor del maestro
    if (action === 'vincular_compra_proveedor') {
      const { compra_id, proveedor_id } = body
      const { error } = await sb.from('disabi_compras')
        .update({ proveedor_id }).eq('id', compra_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/proveedores]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

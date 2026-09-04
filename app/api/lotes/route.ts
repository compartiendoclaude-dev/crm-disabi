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
    // ── Crear / editar lote ─────────────────────────────────────────────────
    if (action === 'save_lote') {
      const {
        editId, producto_id, numero_lote, fecha_vencimiento,
        fecha_ingreso, cantidad_inicial, compra_id, notas,
      } = body

      if (!producto_id || !numero_lote || !fecha_vencimiento || !cantidad_inicial)
        return NextResponse.json({ error: 'Producto, lote, vencimiento y cantidad son requeridos' }, { status: 400 })

      const cantInicial = parseInt(cantidad_inicial)

      const obj = {
        producto_id,
        numero_lote:      numero_lote.trim().toUpperCase(),
        fecha_vencimiento,
        fecha_ingreso:    fecha_ingreso || today(),
        cantidad_inicial: cantInicial,
        cantidad_actual:  cantInicial,  // al crear, cantidad_actual = cantidad_inicial
        compra_id:        compra_id || null,
        notas:            notas || null,
        activo:           true,
      }

      if (editId) {
        // En edición no se toca cantidad_actual (ya fue modificada por ventas)
        const { cantidad_actual: _, ...objEdit } = obj
        void _
        const { error } = await sb.from('disabi_lotes').update(objEdit).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_lotes').insert([obj]).select().single()
        if (error) throw error

        // También actualizar stock del producto
        const { data: prod } = await sb.from('disabi_productos')
          .select('stock_actual').eq('id', producto_id).single()
        if (prod) {
          await sb.from('disabi_productos')
            .update({ stock_actual: (prod.stock_actual || 0) + cantInicial })
            .eq('id', producto_id)
          // Kardex de entrada por lote
          await sb.from('disabi_movimientos_inv').insert([{
            producto_id,
            tipo:          'Entrada',
            cantidad:      cantInicial,
            stock_antes:   prod.stock_actual || 0,
            stock_despues: (prod.stock_actual || 0) + cantInicial,
            referencia:    `Lote ${numero_lote}`,
            motivo:        `Ingreso lote — vence ${fecha_vencimiento}`,
            fecha:         fecha_ingreso || today(),
          }])
        }

        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── Ajustar cantidad de un lote (sin modificar stock general) ───────────
    if (action === 'ajustar_lote') {
      const { id, cantidad_actual, motivo } = body
      const cant = parseInt(cantidad_actual)
      if (cant < 0) return NextResponse.json({ error: 'Cantidad no puede ser negativa' }, { status: 400 })

      const { data: lote } = await sb.from('disabi_lotes')
        .select('cantidad_actual, producto_id, numero_lote').eq('id', id).single()
      if (!lote) return NextResponse.json({ error: 'Lote no encontrado' }, { status: 404 })

      const diff = cant - (lote.cantidad_actual || 0)

      const { error } = await sb.from('disabi_lotes')
        .update({ cantidad_actual: cant, activo: cant > 0 }).eq('id', id)
      if (error) throw error

      // Reflejar ajuste en stock del producto
      if (diff !== 0) {
        const { data: prod } = await sb.from('disabi_productos')
          .select('stock_actual').eq('id', lote.producto_id).single()
        if (prod) {
          const nuevoStock = Math.max(0, (prod.stock_actual || 0) + diff)
          await sb.from('disabi_productos')
            .update({ stock_actual: nuevoStock }).eq('id', lote.producto_id)
          await sb.from('disabi_movimientos_inv').insert([{
            producto_id:   lote.producto_id,
            tipo:          'ajuste',
            cantidad:      Math.abs(diff),
            stock_antes:   prod.stock_actual || 0,
            stock_despues: nuevoStock,
            referencia:    `Lote ${lote.numero_lote}`,
            motivo:        motivo || 'Ajuste de lote',
            fecha:         today(),
          }])
        }
      }

      return NextResponse.json({ ok: true })
    }

    // ── Desactivar lote (sin stock) ─────────────────────────────────────────
    if (action === 'delete_lote') {
      const { id } = body
      const { error } = await sb.from('disabi_lotes').update({ activo: false }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Lotes por producto (para selector en ventas/devoluciones) ───────────
    if (action === 'get_lotes_producto') {
      const { producto_id } = body
      const { data } = await sb.from('disabi_lotes')
        .select('*')
        .eq('producto_id', producto_id)
        .eq('activo', true)
        .gt('cantidad_actual', 0)
        .order('fecha_vencimiento')  // FIFO: primero el que vence antes
      return NextResponse.json({ ok: true, lotes: data ?? [] })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/lotes]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

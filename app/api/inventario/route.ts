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

async function getUser() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  return user
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const sb   = await createClient()
  const body = await req.json()
  const { action } = body

  try {
    // ── PRODUCTO: guardar ───────────────────────────────────────────────────
    if (action === 'save_producto') {
      const { editId, codigo, nombre, descripcion, categoria, unidad,
              precio_venta, costo_unitario, stock_inicial, stock_minimo, activo } = body

      if (!codigo?.trim() || !nombre?.trim())
        return NextResponse.json({ error: 'Código y nombre son requeridos' }, { status: 400 })

      const obj = {
        codigo: codigo.trim(), nombre: nombre.trim(),
        descripcion: descripcion || null,
        categoria:   categoria || 'Otro',
        unidad:      unidad || 'unidad',
        precio_venta:   parseFloat(precio_venta)   || 0,
        costo_unitario: parseFloat(costo_unitario) || 0,
        stock_minimo:   parseInt(stock_minimo)     || 0,
        activo:         activo !== false,
      }

      if (editId) {
        const { error } = await sb.from('disabi_productos').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const stockInicial = parseInt(stock_inicial) || 0
        const { data, error } = await sb.from('disabi_productos')
          .insert([{ ...obj, stock_actual: stockInicial }]).select().single()
        if (error) throw error
        // Movimiento inicial
        if (stockInicial > 0) {
          await sb.from('disabi_movimientos_inv').insert([{
            producto_id: data.id, tipo: 'Entrada', cantidad: stockInicial,
            stock_antes: 0, stock_despues: stockInicial,
            motivo: 'Stock inicial', fecha: today(),
          }])
        }
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── PRODUCTO: eliminar (soft-delete) ────────────────────────────────────
    if (action === 'delete_producto') {
      const { id } = body
      const { error } = await sb.from('disabi_productos').update({ activo: false }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── MOVIMIENTO MANUAL (ajuste/entrada/salida) ───────────────────────────
    if (action === 'save_movimiento') {
      const { producto_id, tipo, cantidad, costo_unitario, referencia, motivo, fecha } = body
      if (!producto_id || !tipo || !cantidad)
        return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })

      // Leer stock actual
      const { data: prod } = await sb.from('disabi_productos')
        .select('stock_actual').eq('id', producto_id).single()
      if (!prod) return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 })

      const stockAntes = prod.stock_actual || 0
      const cant = parseInt(cantidad)
      // Acepta 'Salida' (capitalizado, ventas) y 'salida' (legacy, movimientos manuales)
      const esEgreso = tipo === 'Salida' || tipo === 'salida' || tipo === 'muestra' || tipo === 'Muestra'
      const stockDespues = esEgreso
        ? Math.max(0, stockAntes - cant)
        : stockAntes + cant

      const { data: mov, error: movErr } = await sb.from('disabi_movimientos_inv')
        .insert([{
          producto_id, tipo, cantidad: cant,
          stock_antes: stockAntes, stock_despues: stockDespues,
          costo_unitario: parseFloat(costo_unitario) || null,
          referencia: referencia || null,
          motivo: motivo || null,
          fecha: fecha || today(),
        }]).select().single()
      if (movErr) throw movErr

      // Actualizar stock
      await sb.from('disabi_productos').update({ stock_actual: stockDespues }).eq('id', producto_id)

      return NextResponse.json({ ok: true, stockDespues, movimiento: mov })
    }

    // ── Obtener lista de productos activos para formularios ────────────────
    if (action === 'get_productos') {
      const { data } = await sb.from('disabi_productos')
        .select('id, codigo, nombre, costo_unitario, precio_venta, stock_actual, categoria')
        .eq('activo', true).order('nombre')
      return NextResponse.json({ ok: true, productos: data ?? [] })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/inventario]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

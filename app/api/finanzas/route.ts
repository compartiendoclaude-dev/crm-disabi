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
    // ── CXC: registrar abono ────────────────────────────────────────────────
    if (action === 'save_cxc_abono') {
      const { cxc_id, monto, fecha, notas } = body
      if (!cxc_id || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const { data: cxc } = await sb.from('disabi_cxc').select('saldo, estado').eq('id', cxc_id).single()
      if (!cxc) return NextResponse.json({ error: 'CXC no encontrada' }, { status: 404 })

      const abonoMonto = parseFloat(monto)
      const nuevoSaldo = Math.max(0, parseFloat((cxc.saldo - abonoMonto).toFixed(2)))
      const nuevoEstado = nuevoSaldo <= 0 ? 'Pagado' : abonoMonto < cxc.saldo ? 'Parcial' : 'Pendiente'

      const { error: aErr } = await sb.from('disabi_cxc_abonos').insert([{
        cxc_id, monto: abonoMonto, fecha: fecha || today(), notas: notas || null,
      }])
      if (aErr) throw aErr

      const { error: uErr } = await sb.from('disabi_cxc').update({ saldo: nuevoSaldo, estado: nuevoEstado }).eq('id', cxc_id)
      if (uErr) throw uErr

      return NextResponse.json({ ok: true, nuevoSaldo, nuevoEstado })
    }

    // ── CPP: registrar pago ─────────────────────────────────────────────────
    if (action === 'save_cpp_pago') {
      const { cpp_id, monto, fecha, notas } = body
      if (!cpp_id || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const { data: cpp } = await sb.from('disabi_cpp').select('saldo, estado').eq('id', cpp_id).single()
      if (!cpp) return NextResponse.json({ error: 'CPP no encontrada' }, { status: 404 })

      const pagoMonto  = parseFloat(monto)
      const nuevoSaldo = Math.max(0, parseFloat((cpp.saldo - pagoMonto).toFixed(2)))
      const nuevoEstado = nuevoSaldo <= 0 ? 'Pagado' : 'Parcial'

      const { error: pErr } = await sb.from('disabi_cpp_pagos').insert([{
        cpp_id, monto: pagoMonto, fecha: fecha || today(), notas: notas || null,
      }])
      if (pErr) throw pErr

      const { error: uErr } = await sb.from('disabi_cpp').update({ saldo: nuevoSaldo, estado: nuevoEstado }).eq('id', cpp_id)
      if (uErr) throw uErr

      return NextResponse.json({ ok: true, nuevoSaldo, nuevoEstado })
    }

    // ── GASTO: guardar ──────────────────────────────────────────────────────
    if (action === 'save_gasto') {
      const { editId, fecha, categoria, descripcion, monto, factura, proveedor, tipo_egreso } = body
      if (!fecha || !monto || monto <= 0)
        return NextResponse.json({ error: 'Fecha y monto son requeridos' }, { status: 400 })

      // tipo_egreso clasifica el gasto en el Estado de Resultados:
      // 'operativo'      → Gastos operativos variables
      // 'compra_local'   → Costo de Ventas (mercadería)
      // 'planilla'       → Planilla y honorarios (solo si se ingresa manualmente)
      // 'comision_venta' → Comisiones a vendedores (solo si se ingresa manualmente)
      const tipoEgreso = tipo_egreso || 'operativo'

      const obj = {
        fecha, categoria: categoria || 'Otro',
        descripcion: descripcion || null,
        monto: parseFloat(monto),
        factura: factura || 'Sí',
        proveedor: proveedor || null,
        tipo_egreso: tipoEgreso,
      }

      if (editId) {
        const { error } = await sb.from('disabi_gastos').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_gastos').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── GASTO: eliminar ─────────────────────────────────────────────────────
    if (action === 'delete_gasto') {
      const { id } = body
      const { error } = await sb.from('disabi_gastos').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── COSTO FIJO: guardar ─────────────────────────────────────────────────
    if (action === 'save_costo_fijo') {
      const { editId, concepto, categoria, monto, frecuencia, vence_dia, proveedor, activo, notas } = body
      if (!concepto?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Concepto y monto son requeridos' }, { status: 400 })

      const obj = {
        descripcion: concepto.trim(),
        categoria:   categoria || 'Otro',
        monto:       parseFloat(monto),
        frecuencia:  frecuencia || 'Mensual',
        vence_dia:   vence_dia ? parseInt(vence_dia) : null,
        proveedor:   proveedor || null,
        activo:      activo !== false,
        notas:       notas || null,
      }

      if (editId) {
        const { error } = await sb.from('disabi_costos_fijos').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_costos_fijos').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── COSTO FIJO: eliminar ────────────────────────────────────────────────
    if (action === 'delete_costo_fijo') {
      const { id } = body
      const { error } = await sb.from('disabi_costos_fijos').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/finanzas]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// ── GET — datos del balance por mes seleccionado ─────────────────────────────
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const url = new URL(req.url)
    const mes = url.searchParams.get('mes') || undefined
    if (mes && !/^\d{4}-\d{2}$/.test(mes))
      return NextResponse.json({ error: 'Formato inválido. Use YYYY-MM' }, { status: 400 })

    const { getFinanzasData } = await import('@/lib/clientes-finanzas-data')
    const d = await getFinanzasData(mes)
    return NextResponse.json({ ok: true, data: d })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

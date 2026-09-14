import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'
import { crearAsientoContable, borrarAsientoDeOrigen, CUENTA } from '@/lib/contabilidad-server'

const rateLimit = makeRateLimiter(30)

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error
  const { user } = guard

  const sb = await createClient()
  const body = await req.json()
  const { action } = body

  try {
    // ── Registrar saldo de apertura de BANCO ────────────────────────────────
    // Se crea como un movimiento tipo 'credito' fechado el día del corte,
    // ya conciliado, para que el saldo corrido del banco arranque correcto.
    if (action === 'apertura_banco') {
      const { fecha_corte, cuenta, monto } = body
      if (!fecha_corte || !monto || monto < 0)
        return NextResponse.json({ error: 'Fecha y monto son requeridos' }, { status: 400 })

      // Evitar duplicar apertura de la misma cuenta
      const { data: existente } = await sb.from('disabi_movimientos_banco')
        .select('id').eq('origen', 'apertura').eq('cuenta', cuenta || 'Principal').maybeSingle()
      if (existente)
        return NextResponse.json({ error: 'Ya existe un saldo de apertura para esta cuenta. Elimínalo primero si necesitas corregirlo.' }, { status: 400 })

      const { error } = await sb.from('disabi_movimientos_banco').insert([{
        fecha: fecha_corte,
        descripcion: 'SALDO DE APERTURA',
        tipo: 'credito',
        monto: parseFloat(monto),
        cuenta: cuenta || 'Principal',
        conciliado: true,
        origen: 'apertura',
        notas: 'Saldo bancario real al momento de iniciar operación en el ERP',
      }])
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Registrar saldo de apertura de INVENTARIO (por producto) ───────────
    if (action === 'apertura_inventario') {
      const { fecha_corte, items } = body as { fecha_corte: string; items: { producto_id: string; cantidad: number }[] }
      if (!fecha_corte || !items?.length)
        return NextResponse.json({ error: 'Fecha e items son requeridos' }, { status: 400 })

      let actualizados = 0
      for (const item of items) {
        const { data: prod } = await sb.from('disabi_productos')
          .select('stock_actual').eq('id', item.producto_id).single()
        if (!prod) continue

        // Ajustar el stock actual al conteo físico de apertura
        await sb.from('disabi_productos')
          .update({ stock_actual: item.cantidad }).eq('id', item.producto_id)

        await sb.from('disabi_movimientos_inv').insert([{
          producto_id: item.producto_id,
          tipo: 'Ajuste',
          cantidad: item.cantidad,
          stock_antes: prod.stock_actual,
          stock_despues: item.cantidad,
          motivo: 'SALDO DE APERTURA — conteo físico inicial',
          fecha: fecha_corte,
        }])
        actualizados++
      }
      return NextResponse.json({ ok: true, actualizados })
    }

    // ── Registrar CxC de apertura (clientes que deben al corte) ─────────────
    if (action === 'apertura_cxc') {
      const { fecha_corte, cliente, monto } = body
      if (!fecha_corte || !cliente?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const montoNum = parseFloat(monto)
      const { error } = await sb.from('disabi_cxc').insert([{
        cliente: cliente.trim(),
        monto_total: montoNum,
        monto_pagado: 0,
        monto_pendiente: montoNum,
        estado: 'Pendiente',
        fecha_venta: fecha_corte,
        origen: 'apertura',
        notas: 'Saldo de apertura — deuda del cliente al iniciar operación en el ERP',
      }])
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Registrar CPP de apertura (lo que DISABI debe al corte) ─────────────
    if (action === 'apertura_cpp') {
      const { fecha_corte, proveedor, monto } = body
      if (!fecha_corte || !proveedor?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const montoNum = parseFloat(monto)
      const { error } = await sb.from('disabi_cpp').insert([{
        proveedor: proveedor.trim(),
        monto_total: montoNum,
        monto_pagado: 0,
        monto_pendiente: montoNum,
        estado: 'Pendiente',
        fecha_emision: fecha_corte,
        origen: 'apertura',
        notas: 'Saldo de apertura — deuda con proveedor al iniciar operación en el ERP',
      }])
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Registrar el Balance de Apertura completo (Activos = Pasivos + Capital) ──
    if (action === 'guardar_balance_apertura') {
      const { fecha_corte, lineas } = body as { fecha_corte: string; lineas: { concepto: string; monto: number; tipo: 'activo' | 'pasivo' | 'capital'; notas?: string }[] }
      if (!fecha_corte || !lineas?.length)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      // Reemplazar cualquier balance de apertura previo para esta fecha
      await sb.from('disabi_balance_apertura').delete().eq('fecha_corte', fecha_corte)

      const rows = lineas.map(l => ({
        fecha_corte, concepto: l.concepto, monto: l.monto, tipo: l.tipo, notas: l.notas || null,
      }))
      const { error } = await sb.from('disabi_balance_apertura').insert(rows)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ══════════════════════════════════════════════════════════════════
    // CONTABILIDAD (Fase 3) — Asiento de Apertura.
    // ══════════════════════════════════════════════════════════════════
    // Lee lo que ya está cargado aquí mismo (banco, CxC, CPP, conteo físico
    // de inventario) y postea UN asiento contable balanceado a la fecha de
    // corte: Debe Bancos/CxC/Inventario, Haber CxP, y la diferencia contra
    // Utilidades Retenidas (el patrimonio "heredado" de antes del libro
    // contable). No migra ventas/gastos/compras históricos uno por uno —
    // solo el punto de partida del balance general.
    //
    // Repetible: si vuelves a presionar el botón después de cargar más
    // saldos de apertura, se borra el asiento anterior y se postea de nuevo
    // con los totales actualizados (mismo criterio que Planilla/Comisiones).
    if (action === 'generar_asiento_apertura') {
      const { fecha_corte } = body
      if (!fecha_corte) return NextResponse.json({ error: 'Fecha de corte requerida' }, { status: 400 })

      const [
        { data: bancoRows },
        { data: cxcRows },
        { data: cppRows },
        { data: invRows },
      ] = await Promise.all([
        sb.from('disabi_movimientos_banco').select('monto').eq('origen', 'apertura'),
        sb.from('disabi_cxc').select('monto_pendiente').eq('origen', 'apertura'),
        sb.from('disabi_cpp').select('monto_pendiente').eq('origen', 'apertura'),
        sb.from('disabi_movimientos_inv')
          .select('producto_id, cantidad, created_at, producto:disabi_productos(costo_unitario)')
          .ilike('motivo', '%SALDO DE APERTURA%')
          .order('created_at', { ascending: false }),
      ])

      const montoBanco = (bancoRows ?? []).reduce((a, b) => a + (b.monto ?? 0), 0)
      const montoCxc   = (cxcRows ?? []).reduce((a, c) => a + (c.monto_pendiente ?? 0), 0)
      const montoCpp   = (cppRows ?? []).reduce((a, c) => a + (c.monto_pendiente ?? 0), 0)

      // Un producto puede tener más de un ajuste de apertura (si se corrigió
      // el conteo) — se toma solo el más reciente por producto_id, ya
      // ordenado desc arriba.
      const vistoInventario = new Set<string>()
      let montoInventario = 0
      for (const mv of (invRows ?? []) as { producto_id?: string; cantidad: number; producto?: { costo_unitario?: number } | { costo_unitario?: number }[] | null }[]) {
        if (!mv.producto_id || vistoInventario.has(mv.producto_id)) continue
        vistoInventario.add(mv.producto_id)
        const prod = Array.isArray(mv.producto) ? mv.producto[0] : mv.producto
        montoInventario += mv.cantidad * (prod?.costo_unitario ?? 0)
      }
      montoInventario = parseFloat(montoInventario.toFixed(2))

      const montoPatrimonio = parseFloat((montoBanco + montoCxc + montoInventario - montoCpp).toFixed(2))

      const { data: marca, error: marcaErr } = await sb.from('disabi_apertura_contable')
        .upsert({
          fecha_corte, monto_banco: montoBanco, monto_cxc: montoCxc, monto_cpp: montoCpp,
          monto_inventario: montoInventario, monto_patrimonio: montoPatrimonio,
          generado_por: user.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'fecha_corte' })
        .select().single()
      if (marcaErr) throw marcaErr

      await borrarAsientoDeOrigen(sb, 'disabi_apertura_contable', marca.id)

      const lineas = [
        montoBanco      > 0 ? { cuenta: CUENTA.BANCOS,               debe: montoBanco,      descripcion: 'Saldo bancario de apertura' } : null,
        montoCxc        > 0 ? { cuenta: CUENTA.CXC_CLIENTES,          debe: montoCxc,        descripcion: 'CxC de apertura' } : null,
        montoInventario > 0 ? { cuenta: CUENTA.INVENTARIO_DISPONIBLE, debe: montoInventario, descripcion: 'Inventario de apertura (conteo físico)' } : null,
        montoCpp        > 0 ? { cuenta: CUENTA.CXP_PROVEEDORES,       haber: montoCpp,       descripcion: 'CPP de apertura' } : null,
        montoPatrimonio > 0 ? { cuenta: CUENTA.UTILIDADES_RETENIDAS,  haber: montoPatrimonio, descripcion: 'Patrimonio de apertura (diferencia)' } : null,
        montoPatrimonio < 0 ? { cuenta: CUENTA.UTILIDADES_RETENIDAS,  debe: -montoPatrimonio, descripcion: 'Patrimonio de apertura (déficit)' } : null,
      ].filter((l): l is NonNullable<typeof l> => l !== null)

      const asientoId = await crearAsientoContable(sb, {
        fecha: fecha_corte,
        concepto: `Asiento de Apertura — ${fecha_corte}`,
        origenTabla: 'disabi_apertura_contable',
        origenId: marca.id,
        lineas,
        creadoPor: user.id,
      })

      return NextResponse.json({
        ok: true, posteado: !!asientoId,
        totales: { montoBanco, montoCxc, montoCpp, montoInventario, montoPatrimonio },
      })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    console.error('[api/apertura]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── GET: resumen del estado de apertura (qué está cargado, qué falta) ─────────
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  const sb = await createClient()

  try {
    const [
      { data: bancoApertura },
      { data: cxcApertura },
      { data: cppApertura },
      { data: inventarioApertura },
      { data: balanceApertura },
    ] = await Promise.all([
      sb.from('disabi_movimientos_banco').select('*').eq('origen', 'apertura'),
      sb.from('disabi_cxc').select('*').eq('origen', 'apertura'),
      sb.from('disabi_cpp').select('*').eq('origen', 'apertura'),
      sb.from('disabi_movimientos_inv').select('*').ilike('motivo', '%SALDO DE APERTURA%'),
      sb.from('disabi_balance_apertura').select('*').order('fecha_corte', { ascending: false }),
    ])

    return NextResponse.json({
      ok: true,
      banco: bancoApertura ?? [],
      cxc: cxcApertura ?? [],
      cpp: cppApertura ?? [],
      inventario: inventarioApertura ?? [],
      balance: balanceApertura ?? [],
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

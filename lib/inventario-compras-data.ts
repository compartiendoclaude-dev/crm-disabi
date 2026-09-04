import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// ── Inventario ────────────────────────────────────────────────────────────────
export async function getInventarioData() {
  const sb  = await createClient()
  const hoy  = today()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30)
  const en60 = new Date(hoy); en60.setDate(en60.getDate() + 60)
  const en30s = en30.toISOString().slice(0, 10)
  const en60s = en60.toISOString().slice(0, 10)

  const [
    { data: productos },
    { data: movimientos },
    { data: ventasItems },
    { data: lotes },
  ] = await Promise.all([
    sb.from('disabi_productos')
      .select('*')
      .order('nombre'),

    sb.from('disabi_movimientos_inv')
      .select('*, producto:disabi_productos(nombre, codigo)')
      .order('fecha', { ascending: false })
      .limit(300),

    // Ventas del mes para calcular rotación
    sb.from('disabi_venta_items')
      .select('producto_id, cantidad, venta:disabi_ventas!inner(fecha, cobro)')
      .gte('venta.fecha', mesInicio)
      .lte('venta.fecha', mesFin)
      .neq('venta.cobro', 'Borrador'),

    // Lotes para vencimientos
    sb.from('disabi_lotes')
      .select('*, producto:disabi_productos(nombre, codigo, unidad)')
      .order('fecha_vencimiento')
      .limit(300),
  ])

  const prods = productos ?? []

  // KPIs
  const valorInventario = prods.reduce((a, p) =>
    a + (p.stock_actual || 0) * (p.precio_costo || p.costo_unitario || 0), 0)

  const enReorden = prods.filter(p =>
    p.activo !== false && (p.stock_actual || 0) <= (p.stock_minimo || 0) && (p.stock_actual || 0) > 0).length

  const sinStock = prods.filter(p =>
    p.activo !== false && (p.stock_actual || 0) <= 0).length

  // Rotación por producto este mes
  const rotMap: Record<string, number> = {}
  ;(ventasItems ?? []).forEach((vi: { producto_id?: string; cantidad?: number }) => {
    if (vi.producto_id) rotMap[vi.producto_id] = (rotMap[vi.producto_id] || 0) + (vi.cantidad || 0)
  })

  const topProd = prods
    .map(p => ({ nombre: p.nombre, rot: rotMap[p.id] || 0 }))
    .sort((a, b) => b.rot - a.rot)[0]

  // Capital inmovilizado: sin movimientos en 30 días
  const hace30 = new Date(hoy)
  hace30.setDate(hace30.getDate() - 30)
  const hace30Str = hace30.toISOString().slice(0, 10)
  const movRecientes = new Set((movimientos ?? [])
    .filter(m => m.fecha >= hace30Str)
    .map(m => m.producto_id))
  const capitalInmovilizado = prods
    .filter(p => p.activo !== false && !movRecientes.has(p.id) && (p.stock_actual || 0) > 0)
    .reduce((a, p) => a + (p.stock_actual || 0) * (p.precio_costo || p.costo_unitario || 0), 0)

  const ls = lotes ?? []
  const lotesKpis = {
    totalLotes: ls.filter(l => l.activo !== false && (l.cantidad_actual ?? 0) > 0).length,
    vencidos:   ls.filter(l => l.fecha_vencimiento < hoy && (l.cantidad_actual ?? 0) > 0).length,
    vencen30:   ls.filter(l => l.fecha_vencimiento >= hoy && l.fecha_vencimiento <= en30s && (l.cantidad_actual ?? 0) > 0).length,
    vencen60:   ls.filter(l => l.fecha_vencimiento > en30s && l.fecha_vencimiento <= en60s && (l.cantidad_actual ?? 0) > 0).length,
    agotados:   ls.filter(l => (l.cantidad_actual ?? 0) <= 0 && l.activo !== false).length,
  }

  return {
    productos: prods,
    movimientos: movimientos ?? [],
    lotes: ls,
    lotesKpis,
    hoy, en30s, en60s,
    kpis: {
      valorInventario,
      enReorden,
      sinStock,
      topProdNombre: topProd?.nombre ?? '–',
      topProdRot:    topProd?.rot ?? 0,
      capitalInmovilizado,
      totalProductos: prods.filter(p => p.activo !== false).length,
    },
  }
}

// ── Compras ───────────────────────────────────────────────────────────────────
export async function getComprasData() {
  const sb  = await createClient()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = new Date(parseInt(ym.slice(0,4)), parseInt(ym.slice(5,7)), 0).toISOString().slice(0, 10)

  const [
    { data: compras },
    { data: compraItems },
    { data: gastosLocales },
    { data: productos },
    { data: proveedores },
  ] = await Promise.all([
    sb.from('disabi_compras')
      .select('*, items:disabi_compra_items(*, producto:disabi_productos(nombre, codigo))')
      .order('fecha', { ascending: false })
      .limit(100),

    sb.from('disabi_compra_items')
      .select('*, producto:disabi_productos(nombre, codigo)')
      .limit(500),

    // Compras locales viven en disabi_gastos con tipo_compra='Local'
    sb.from('disabi_gastos')
      .select('*')
      .eq('tipo_compra', 'Local')
      .order('fecha', { ascending: false })
      .limit(100),

    sb.from('disabi_productos')
      .select('id, codigo, nombre, costo_unitario, stock_actual')
      .eq('activo', true)
      .order('nombre'),

    sb.from('disabi_proveedores')
      .select('*')
      .order('nombre'),
  ])

  const cmpAll  = compras ?? []
  const cmpMes  = cmpAll.filter(c => (c.fecha || '') >= mesInicio && (c.fecha || '') <= mesFin)

  const kpis = {
    importacionMes: cmpMes.filter(c => c.tipo === 'importacion').reduce((a, c) => a + (c.monto_final || c.total || 0), 0),
    localMes:       (gastosLocales ?? []).filter(g => (g.fecha || '') >= mesInicio && (g.fecha || '') <= mesFin)
                      .reduce((a, g) => a + (g.monto || 0), 0),
    enTransito:     cmpAll.filter(c => c.estado === 'En tránsito').length,
    recibidaMes:    cmpMes.filter(c => c.estado === 'Recibido').length,
    fleteAcum:      cmpMes.reduce((a, c) => a + (c.flete || 0), 0),
    impuestosAcum:  cmpMes.reduce((a, c) => a + (c.impuestos || 0), 0),
  }

  // Enriquecer proveedores con historial de compras
  const provs = proveedores ?? []
  const proveedoresEnriquecidos = provs.map(p => {
    const vinculadas = cmpAll.filter(c => (c as unknown as { proveedor_id?: string }).proveedor_id === p.id)
    const porNombre  = cmpAll.filter(c =>
      !(c as unknown as { proveedor_id?: string }).proveedor_id &&
      (c.proveedor ?? '').toLowerCase().trim() === p.nombre.toLowerCase().trim()
    )
    const todas = [...vinculadas, ...porNombre]
    return {
      ...p,
      num_compras:    todas.length,
      total_comprado: todas.reduce((a, c) => a + ((c as unknown as { monto_final?: number }).monto_final ?? c.total ?? 0), 0),
      ultima_compra:  todas.sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))[0]?.fecha ?? null,
    }
  })

  const idsVinculados = new Set(provs.map(p => p.id))
  const comprasSinVincular = cmpAll.filter(c =>
    !(c as unknown as { proveedor_id?: string }).proveedor_id ||
    !idsVinculados.has((c as unknown as { proveedor_id?: string }).proveedor_id ?? '')
  ).map(c => ({
    id: c.id,
    proveedor: c.proveedor,
    fecha: c.fecha,
    monto_final: (c as unknown as { monto_final?: number }).monto_final,
    monto_total: (c as unknown as { monto_total?: number }).monto_total,
  }))
  const proveedoresTextoLibre = Array.from(new Set(comprasSinVincular.map(c => c.proveedor).filter(Boolean))) as string[]

  return {
    compras: cmpAll,
    compraItems: compraItems ?? [],
    gastosLocales: gastosLocales ?? [],
    productos: productos ?? [],
    proveedores: proveedoresEnriquecidos,
    comprasSinVincular,
    proveedoresTextoLibre,
    proveedoresKpis: {
      total:       provs.length,
      activos:     provs.filter(p => p.activo !== false).length,
      locales:     provs.filter(p => p.tipo === 'local' || p.tipo === 'ambos').length,
      importacion: provs.filter(p => p.tipo === 'importacion' || p.tipo === 'ambos').length,
      sinVincular: proveedoresTextoLibre.length,
    },
    kpis,
  }
}

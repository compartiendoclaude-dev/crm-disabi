import { createClient } from '@/lib/supabase-server'
import { today, nowYM } from '@/lib/utils'

// ── Proveedores + historial de compras ───────────────────────────────────────
export async function getProveedoresData() {
  const sb = await createClient()

  const [
    { data: proveedores },
    { data: compras },
  ] = await Promise.all([
    sb.from('disabi_proveedores').select('*').order('nombre'),
    sb.from('disabi_compras')
      .select('id, proveedor, proveedor_id, monto_final, monto_total, fecha, estado, tipo')
      .order('fecha', { ascending: false })
      .limit(200),
  ])

  const provs = proveedores ?? []
  const cmps  = compras ?? []

  // Enriquecer cada proveedor con sus KPIs de compra
  const proveedoresEnriquecidos = provs.map(p => {
    // Compras vinculadas por FK
    const vinculadas = cmps.filter(c => c.proveedor_id === p.id)
    // Compras por nombre (para las que no tienen FK todavía)
    const porNombre  = cmps.filter(c =>
      !c.proveedor_id &&
      (c.proveedor ?? '').toLowerCase().trim() === p.nombre.toLowerCase().trim()
    )
    const todas = [...vinculadas, ...porNombre]
    const total = todas.reduce((a, c) =>
      a + (c.monto_final ?? c.monto_total ?? 0), 0)
    const ultima = todas.sort((a, b) =>
      (b.fecha ?? '').localeCompare(a.fecha ?? ''))[0]?.fecha ?? null

    return {
      ...p,
      num_compras:    todas.length,
      total_comprado: total,
      ultima_compra:  ultima,
    }
  })

  // Compras sin proveedor vinculado (texto libre)
  const idsVinculados = new Set(provs.map(p => p.id))
  const comprasSinVincular = cmps.filter(c =>
    !c.proveedor_id || !idsVinculados.has(c.proveedor_id)
  )
  const proveedoresTextoLibre = Array.from(new Set(
    comprasSinVincular.map(c => c.proveedor).filter(Boolean)
  ))

  const kpis = {
    total:       provs.length,
    activos:     provs.filter(p => p.activo !== false).length,
    locales:     provs.filter(p => p.tipo === 'local' || p.tipo === 'ambos').length,
    importacion: provs.filter(p => p.tipo === 'importacion' || p.tipo === 'ambos').length,
    sinVincular: proveedoresTextoLibre.length,
  }

  return {
    proveedores: proveedoresEnriquecidos,
    comprasSinVincular,
    proveedoresTextoLibre,
    kpis,
  }
}

// ── Lotes — inventario con vencimientos ──────────────────────────────────────
export async function getLotesData() {
  const sb  = await createClient()
  const hoy  = today()
  const en30 = new Date(hoy); en30.setDate(en30.getDate() + 30)
  const en60 = new Date(hoy); en60.setDate(en60.getDate() + 60)
  const en30s = en30.toISOString().slice(0, 10)
  const en60s = en60.toISOString().slice(0, 10)

  const [
    { data: lotes },
    { data: productos },
  ] = await Promise.all([
    sb.from('disabi_lotes')
      .select('*, producto:disabi_productos(nombre, codigo, unidad)')
      .order('fecha_vencimiento')
      .limit(500),
    sb.from('disabi_productos').select('id, codigo, nombre, unidad').eq('activo', true).order('nombre'),
  ])

  const ls = lotes ?? []

  const kpis = {
    totalLotes:     ls.filter(l => l.activo !== false && l.cantidad_actual > 0).length,
    vencidos:       ls.filter(l => l.fecha_vencimiento < hoy && l.cantidad_actual > 0).length,
    vencen30:       ls.filter(l => l.fecha_vencimiento >= hoy && l.fecha_vencimiento <= en30s && l.cantidad_actual > 0).length,
    vencen60:       ls.filter(l => l.fecha_vencimiento > en30s && l.fecha_vencimiento <= en60s && l.cantidad_actual > 0).length,
    agotados:       ls.filter(l => l.cantidad_actual <= 0 && l.activo !== false).length,
  }

  return { lotes: ls, productos: productos ?? [], kpis, hoy, en30s, en60s }
}

// ── Devoluciones ──────────────────────────────────────────────────────────────
export async function getDevolucionesData() {
  const sb  = await createClient()
  const ym   = nowYM()
  const mesInicio = ym + '-01'
  const mesFin    = ym + '-31'

  const [
    { data: devoluciones },
    { data: ventas },
    { data: productos },
  ] = await Promise.all([
    sb.from('disabi_devoluciones')
      .select('*, venta:disabi_ventas(numero, nombre, monto, cobro), items:disabi_devolucion_items(*, producto:disabi_productos(nombre, codigo))')
      .order('fecha', { ascending: false })
      .limit(100),

    // Ventas que pueden ser devueltas (no Borrador, no ya totalmente devueltas)
    sb.from('disabi_ventas')
      .select('id, numero, nombre, fecha, monto, cobro, devolucion_estado, items:disabi_venta_items(*, producto:disabi_productos(nombre, codigo, precio_venta))')
      .neq('cobro', 'Borrador')
      .neq('devolucion_estado', 'Devuelta')
      .order('fecha', { ascending: false })
      .limit(200),

    sb.from('disabi_productos').select('id, nombre, codigo').eq('activo', true).order('nombre'),
  ])

  const devs = devoluciones ?? []

  const kpis = {
    totalMes:    devs.filter(d => (d.fecha ?? '') >= mesInicio && (d.fecha ?? '') <= mesFin).length,
    montoMes:    devs.filter(d => (d.fecha ?? '') >= mesInicio && (d.fecha ?? '') <= mesFin && d.estado === 'Procesada').reduce((a, d) => a + d.monto_devuelto, 0),
    totalGeneral: devs.filter(d => d.estado === 'Procesada').length,
    montoGeneral: devs.filter(d => d.estado === 'Procesada').reduce((a, d) => a + d.monto_devuelto, 0),
  }

  return {
    devoluciones: devs,
    ventasDevolvibles: ventas ?? [],
    productos: productos ?? [],
    kpis, mesActual: ym,
  }
}

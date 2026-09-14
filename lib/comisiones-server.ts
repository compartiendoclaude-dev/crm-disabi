import type { createClient } from './supabase-server'

// ══════════════════════════════════════════════════════════════════════════
// Lógica compartida de cálculo de comisiones — usada tanto por el cálculo
// individual (Comisiones > Calcular, por vendedor) como por la comparación
// contra el Excel maestro (negocio completo, sin filtrar por vendedor).
//
// La categoría que se usa para emparejar contra disabi_comision_rangos es
// disabi_productos.categoria_comision — una clasificación propia del cálculo
// de comisiones, separada de disabi_productos.categoria (que es la categoría
// de Inventario: Sabores/Otro/Insumo/Licencias, y nunca calzó con las
// categorías del Excel de comisiones: Saborizantes/Salsas/Cafe/etc.). Un
// producto sin categoria_comision asignada no genera comisión — no se
// asume nada por él.
// ══════════════════════════════════════════════════════════════════════════

export interface RangoComision {
  id: string
  categoria: string
  precio_iva_desc: string
  precio_min_iva?: number | null
  precio_max_iva?: number | null
  precio_sin_iva: number
  pct_comision: number
  // Cuando true, no se usa el precio_sin_iva fijo de la tabla — se usa el
  // precio real de cada venta (÷1.13). Para categorías sin tramos de precio
  // definidos en el Excel (Matcha, Bases de frappe, Artículos de Bar, Tazas).
  usar_precio_real?: boolean
}

export interface LineaComisionCalc {
  rango_id?: string
  categoria: string
  precio_iva_desc: string
  precio_sin_iva: number
  pct_comision: number
  cantidad_vendida: number
  comision_linea: number
}

// Dado un precio con IVA y una categoría de comisión, encuentra el tramo correcto.
export function matchRango(rangos: RangoComision[], categoria: string, precioIva: number): RangoComision | null {
  if (!categoria) return null
  const candidatos = rangos
    .filter(r => r.categoria === categoria)
    .sort((a, b) => (b.precio_min_iva ?? 0) - (a.precio_min_iva ?? 0))

  for (const r of candidatos) {
    const min = r.precio_min_iva ?? 0
    const max = r.precio_max_iva ?? Infinity
    if (precioIva >= min && precioIva <= max) return r
  }
  return null
}

interface VentaItemRow {
  id?: string
  cantidad: number
  precio_unitario: number
  producto?: { id?: string; nombre?: string; categoria_comision?: string | null; precio_venta?: number } | null
}

// Calcula las líneas de comisión (agrupadas por categoría/tramo) para un
// período. Si se pasa vendedorId, filtra a las ventas de ese vendedor (con
// fallback a modo histórico si el período no tiene vendedor_id asignado en
// las ventas); si no, calcula sobre TODO el negocio — usado para comparar
// contra el Excel maestro, que es un total del negocio, no por vendedor.
export async function calcularLineasComision(
  sb: Awaited<ReturnType<typeof createClient>>,
  periodo: string,
  vendedorId?: string
): Promise<{ lineas: LineaComisionCalc[]; comisionBruta: number; modoLegacy: boolean }> {
  const [anio, mes] = periodo.split('-').map(Number)
  const ini = `${periodo}-01`
  const fin = `${periodo}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`

  const { data: rangos } = await sb.from('disabi_comision_rangos')
    .select('*').eq('activo', true).order('categoria').order('orden')

  const { data: ventaItemsAll } = await sb.from('disabi_venta_items')
    .select(`
      id, cantidad, precio_unitario, subtotal,
      producto:disabi_productos(id, nombre, categoria_comision, precio_venta),
      venta:disabi_ventas!inner(fecha, cobro, nombre, vendedor_id, devolucion_estado)
    `)
    .gte('venta.fecha', ini).lte('venta.fecha', fin)
    .in('venta.cobro', ['Cobrado', 'Pendiente', 'Liquidacion_Pendiente'])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ventaItemsFiltradas = (ventaItemsAll ?? []).filter((vi: any) => {
    const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
    return venta?.devolucion_estado !== 'Devuelta'
  })

  let ventaItems = ventaItemsFiltradas
  let modoLegacy = false
  if (vendedorId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ventaItemsConVendedor = ventaItemsFiltradas.filter((vi: any) => {
      const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
      return venta?.vendedor_id === vendedorId
    })
    ventaItems = ventaItemsConVendedor.length > 0 ? ventaItemsConVendedor : ventaItemsFiltradas
    modoLegacy = ventaItemsConVendedor.length === 0 && ventaItemsFiltradas.length > 0
  }
  // Sin vendedorId: se usa ventaItemsFiltradas completo (negocio entero).

  const { data: devolucionItems } = await sb.from('disabi_devolucion_items')
    .select('producto_id, cantidad, venta_item_id, devolucion:disabi_devoluciones!inner(estado, fecha)')
    .gte('devolucion.fecha', ini).lte('devolucion.fecha', fin)
    .eq('devolucion.estado', 'Procesada')

  const devueltosPorItem: Record<string, number> = {}
  ;(devolucionItems ?? []).forEach((di: { venta_item_id?: string; cantidad: number }) => {
    if (di.venta_item_id) devueltosPorItem[di.venta_item_id] = (devueltosPorItem[di.venta_item_id] ?? 0) + di.cantidad
  })

  const lineasMap: Record<string, { rango: RangoComision; cantidad: number; precioSinIvaReal?: number }> = {}

  for (const vi of (ventaItems ?? []) as VentaItemRow[]) {
    const cat = vi.producto?.categoria_comision ?? ''
    if (!cat) continue
    const precioIva = vi.precio_unitario
    const rango = matchRango((rangos ?? []) as RangoComision[], cat, precioIva)
    if (!rango) continue

    const cantDevuelta = vi.id ? (devueltosPorItem[vi.id] ?? 0) : 0
    const cantComisionable = Math.max(0, vi.cantidad - cantDevuelta)
    if (cantComisionable === 0) continue

    const key = rango.usar_precio_real ? `${rango.id}:${precioIva}` : rango.id
    if (!lineasMap[key]) {
      lineasMap[key] = {
        rango, cantidad: 0,
        precioSinIvaReal: rango.usar_precio_real ? parseFloat((precioIva / 1.13).toFixed(4)) : undefined,
      }
    }
    lineasMap[key].cantidad += cantComisionable
  }

  const lineas: LineaComisionCalc[] = Object.values(lineasMap).map(({ rango, cantidad, precioSinIvaReal }) => {
    const precioUsado = rango.usar_precio_real ? (precioSinIvaReal ?? 0) : rango.precio_sin_iva
    return {
      rango_id: rango.id,
      categoria: rango.categoria,
      precio_iva_desc: rango.usar_precio_real ? `$${(precioUsado * 1.13).toFixed(2)} (precio real)` : rango.precio_iva_desc,
      precio_sin_iva: precioUsado,
      pct_comision: rango.pct_comision,
      cantidad_vendida: cantidad,
      comision_linea: parseFloat((cantidad * precioUsado * rango.pct_comision).toFixed(2)),
    }
  })

  const comisionBruta = parseFloat(lineas.reduce((a, l) => a + l.comision_linea, 0).toFixed(2))

  return { lineas, comisionBruta, modoLegacy }
}

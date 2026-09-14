import { createClient } from '@/lib/supabase-server'

// ── Helpers compartidos entre los reportes de Contabilidad (GET) y las
// acciones que escriben en el libro (POST: asiento manual, cierre de
// ejercicio) — ver app/api/contabilidad/route.ts. Vivían duplicados ahí
// antes de que existiera ningún POST; se movieron aquí para no repetir la
// misma agregación de partidas en dos sitios.

export type CuentaInfo = {
  codigo: string
  nombre: string
  tipo: string
  naturaleza: string
  cuenta_padre: string | null
  nivel: number
  es_imputable: boolean
}

export type Sb = Awaited<ReturnType<typeof createClient>>

export async function getPlanCuentasMap(sb: Sb): Promise<Record<string, CuentaInfo>> {
  const { data, error } = await sb.from('disabi_plan_cuentas')
    .select('codigo, nombre, tipo, naturaleza, cuenta_padre, nivel, es_imputable')
    .order('codigo')
  if (error) throw error
  const map: Record<string, CuentaInfo> = {}
  for (const c of (data ?? []) as CuentaInfo[]) map[c.codigo] = c
  return map
}

// El saldo "normal" de una cuenta: para Activo/Costo/Gasto es debe-haber
// (positivo cuando se comporta como se espera); para Pasivo/Patrimonio/Ingreso
// es haber-debe. Usar SIEMPRE la naturaleza del tipo (no la de cada cuenta
// individual) es lo que hace que las cuentas contrarias (Devoluciones,
// Descuentos, Estimación para Incobrables) se netamente resten del total de su
// grupo en vez de sumarse por error.
export function saldoTipo(tipo: string, debe: number, haber: number): number {
  return (tipo === 'Activo' || tipo === 'Costo' || tipo === 'Gasto') ? (debe - haber) : (haber - debe)
}

// Nombre del grupo nivel 2 (o nivel 1 si no hay nivel 2) al que pertenece una
// cuenta imputable — p.ej. 110102 → "Activo Corriente", 6101 → "Gastos de
// Venta", 4101 → "INGRESOS" (Ingresos no tiene nivel 2).
export function grupoDe(codigo: string, mapa: Record<string, CuentaInfo>): string {
  let actual = mapa[codigo]
  if (!actual) return codigo
  while (actual.nivel > 2 && actual.cuenta_padre && mapa[actual.cuenta_padre]) {
    actual = mapa[actual.cuenta_padre]
  }
  return actual.nombre
}

export type AsientoRow = { id: string; fecha: string; concepto: string; origen_tabla: string; origen_id: string; created_at: string }

export async function asientosEnRango(sb: Sb, opts: { desde?: string; desdeExclusive?: string; hasta?: string }): Promise<AsientoRow[]> {
  let q = sb.from('disabi_asientos_contables').select('id, fecha, concepto, origen_tabla, origen_id, created_at')
  if (opts.desde) q = q.gte('fecha', opts.desde)
  if (opts.desdeExclusive) q = q.lt('fecha', opts.desdeExclusive)
  if (opts.hasta) q = q.lte('fecha', opts.hasta)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AsientoRow[]
}

export type PartidaRow = { asiento_id: string; cuenta_codigo: string; debe: number; haber: number; descripcion: string | null }

// .in() con miles de ids puede volverse una URL enorme — se divide en tandas.
export async function partidasPorAsientoIds(sb: Sb, ids: string[], cuenta?: string): Promise<PartidaRow[]> {
  if (!ids.length) return []
  const CHUNK = 400
  const out: PartidaRow[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    let q = sb.from('disabi_partidas').select('asiento_id, cuenta_codigo, debe, haber, descripcion').in('asiento_id', slice)
    if (cuenta) q = q.eq('cuenta_codigo', cuenta)
    const { data, error } = await q
    if (error) throw error
    out.push(...((data ?? []) as PartidaRow[]))
  }
  return out
}

// ── Un día después de una fecha 'YYYY-MM-DD', en texto — para calcular el
// inicio del ejercicio siguiente a partir de la fecha_hasta del último cierre.
export function diaSiguiente(fechaISO: string): string {
  const d = new Date(fechaISO + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ── Ingresos - Costos - Gastos netos para un rango de fechas, usando la
// misma convención de signo que el resto de reportes. Se reusa tanto para
// el Estado de Resultados como para calcular cuánto cerrar en un cierre de
// ejercicio.
export async function calcularResultadoPeriodo(sb: Sb, mapa: Record<string, CuentaInfo>, desde: string, hasta: string) {
  const asientos = await asientosEnRango(sb, { desde, hasta })
  const partidas = await partidasPorAsientoIds(sb, asientos.map(a => a.id))
  let netIngresos = 0, netCostos = 0, netGastos = 0
  const agregados = new Map<string, { debe: number; haber: number }>()
  for (const p of partidas) {
    const cur = agregados.get(p.cuenta_codigo) ?? { debe: 0, haber: 0 }
    cur.debe += p.debe ?? 0; cur.haber += p.haber ?? 0
    agregados.set(p.cuenta_codigo, cur)
  }
  for (const [codigo, { debe, haber }] of Array.from(agregados.entries())) {
    const info = mapa[codigo]
    if (!info) continue
    const saldo = saldoTipo(info.tipo, debe, haber)
    if (info.tipo === 'Ingreso') netIngresos += saldo
    else if (info.tipo === 'Costo') netCostos += saldo
    else if (info.tipo === 'Gasto') netGastos += saldo
  }
  netIngresos = parseFloat(netIngresos.toFixed(2))
  netCostos = parseFloat(netCostos.toFixed(2))
  netGastos = parseFloat(netGastos.toFixed(2))
  const utilidad = parseFloat((netIngresos - netCostos - netGastos).toFixed(2))
  return { netIngresos, netCostos, netGastos, utilidad }
}

export type CierreEjercicio = {
  id: string; fecha_desde: string; fecha_hasta: string
  neto_ingresos: number; neto_costos: number; neto_gastos: number; utilidad_ejercicio: number
  notas: string | null; cerrado_por: string | null; created_at: string
}

export async function getUltimoCierreEjercicio(sb: Sb): Promise<CierreEjercicio | null> {
  const { data, error } = await sb.from('disabi_cierres_ejercicio')
    .select('*').order('fecha_hasta', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return (data as CierreEjercicio | null) ?? null
}

export async function getCierresEjercicio(sb: Sb): Promise<CierreEjercicio[]> {
  const { data, error } = await sb.from('disabi_cierres_ejercicio')
    .select('*').order('fecha_hasta', { ascending: false })
  if (error) throw error
  return (data ?? []) as CierreEjercicio[]
}

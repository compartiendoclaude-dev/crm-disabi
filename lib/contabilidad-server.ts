import { createClient } from '@/lib/supabase-server'
import { CUENTA, CUENTA_POR_TIPO_EGRESO, CATEGORIA_CPP_CUENTA, CATEGORIA_COSTO_FIJO_CUENTA } from '@/lib/contabilidad-cuentas'

export { CUENTA, CUENTA_POR_TIPO_EGRESO, CATEGORIA_CPP_CUENTA, CATEGORIA_COSTO_FIJO_CUENTA }

// ── Fecha de corte del libro contable de partida doble ──────────────────────
// Decisión de José (Fase 1/3): el libro contable arranca "en limpio" el 1 de
// noviembre de 2026 — no se migra ningún movimiento anterior a esa fecha.
// Por eso crearAsientoContable() no postea nada con fecha < este corte.
export const CORTE_CONTABLE = '2026-11-01'

export type LineaAsiento = {
  cuenta: string
  debe?: number
  haber?: number
  descripcion?: string
}

// ── Reparte un monto que ya incluye IVA (13%, El Salvador) en su parte neta
// y el IVA correspondiente. neto + iva siempre vuelve a sumar el original
// (el IVA se calcula por diferencia, no por multiplicación directa, para
// evitar que el redondeo deje un asiento descuadrado por un centavo).
export function partirIva(montoConIva: number): { neto: number; iva: number } {
  const neto = parseFloat((montoConIva / 1.13).toFixed(2))
  const iva  = parseFloat((montoConIva - neto).toFixed(2))
  return { neto, iva }
}

// ── Último día de un período 'YYYY-MM' (para devengos que solo tienen mes,
// como Planilla y Comisiones — se acumula al cierre del mes, no a un día
// específico dentro de él).
export function finDeMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  const ultimoDia = new Date(y, m, 0).getDate() // día 0 del mes siguiente = último día de este mes
  return `${periodo}-${String(ultimoDia).padStart(2, '0')}`
}

// ── Borra cualquier asiento ya posteado para un origen — se usa ANTES de
// volver a postear algo que ya tenía asiento (editar una venta/compra/
// planilla ya contabilizada, o regenerar una planilla del mes) para no
// duplicar ni dejar el asiento viejo con datos desactualizados. También se
// usa al eliminar el registro de origen, para no dejar un asiento huérfano
// apuntando a una fila que ya no existe.
//
// Pasa por disabi_borrar_asientos_por_origen (RPC SECURITY DEFINER) en vez
// de un DELETE directo sobre la tabla — desde la migración de Fase 5 el rol
// `authenticated` ya no tiene INSERT/UPDATE/DELETE directo sobre
// disabi_asientos_contables/disabi_partidas (ver
// disabi_contabilidad_fase5_activos_fijos_y_rls.sql): cualquier rol
// autenticado sigue pudiendo borrar/crear asientos —porque su propia venta,
// gasto, planilla, etc. necesita poder hacerlo— pero solo a través de estas
// dos funciones, nunca escribiendo la tabla a mano desde fuera de la app.
export async function borrarAsientoDeOrigen(
  sb: Awaited<ReturnType<typeof createClient>>,
  origenTabla: string,
  origenId: string
): Promise<void> {
  await sb.rpc('disabi_borrar_asientos_por_origen', {
    p_origen_tabla: origenTabla,
    p_origen_ids: [origenId],
  })
}

// ── Misma idea que borrarAsientoDeOrigen pero para varios orígenes a la vez
// (ej. todos los abonos de una CxC, o todos los pagos de una CPP, cuando se
// elimina el registro padre) — evita N llamadas RPC cuando una sola con un
// arreglo de ids alcanza.
export async function borrarAsientosPorOrigenes(
  sb: Awaited<ReturnType<typeof createClient>>,
  origenTabla: string,
  origenIds: string[]
): Promise<void> {
  if (!origenIds.length) return
  await sb.rpc('disabi_borrar_asientos_por_origen', {
    p_origen_tabla: origenTabla,
    p_origen_ids: origenIds,
  })
}

// ── Crea un asiento contable (encabezado + líneas) en una sola llamada RPC,
// para que el candado de "Debe = Haber" de disabi_partidas (ver Fase 1) pueda
// validarlo — necesita que todas las líneas se inserten en la misma
// transacción, y una función de Postgres es atómica por definición.
//
// Deliberadamente NO bloqueante: si algo falla al contabilizar, se registra
// en los logs pero la operación de negocio (la venta, el pago, etc.) igual
// se completa — un problema en el libro contable nuevo no debe impedir que
// alguien cierre una venta real. Se revisa en logs, no debería pasar en
// operación normal (el propio candado de la base de datos ya impide que un
// asiento quede descuadrado).
export async function crearAsientoContable(
  sb: Awaited<ReturnType<typeof createClient>>,
  opts: {
    fecha: string
    concepto: string
    origenTabla: string
    origenId: string
    lineas: LineaAsiento[]
    creadoPor?: string | null
  }
): Promise<string | null> {
  // Antes del corte contable no se postea nada — ver CORTE_CONTABLE arriba.
  if (opts.fecha < CORTE_CONTABLE) return null

  const lineas = opts.lineas.filter(l => (l.debe ?? 0) > 0.004 || (l.haber ?? 0) > 0.004)
  if (lineas.length < 2) return null // nada que contabilizar, o solo un lado con monto

  const totalDebe  = lineas.reduce((a, l) => a + (l.debe  ?? 0), 0)
  const totalHaber = lineas.reduce((a, l) => a + (l.haber ?? 0), 0)
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    // No debería ocurrir si la fórmula que arma `lineas` está bien — se deja
    // este chequeo como última línea de defensa antes de llegar al candado
    // de la base de datos, para dar un mensaje de log más claro que el del
    // trigger si algún día pasa.
    console.error('[contabilidad] asiento descuadrado, no se postea', opts.origenTabla, opts.origenId, { totalDebe, totalHaber })
    return null
  }

  const { data, error } = await sb.rpc('disabi_crear_asiento', {
    p_fecha:        opts.fecha,
    p_concepto:     opts.concepto,
    p_origen_tabla: opts.origenTabla,
    p_origen_id:    opts.origenId,
    p_lineas: lineas.map(l => ({
      cuenta_codigo: l.cuenta,
      debe:          parseFloat((l.debe  ?? 0).toFixed(2)),
      haber:         parseFloat((l.haber ?? 0).toFixed(2)),
      descripcion:   l.descripcion ?? null,
    })),
    p_creado_por: opts.creadoPor ?? null,
  })

  if (error) {
    console.error('[contabilidad] no se pudo crear el asiento', opts.origenTabla, opts.origenId, error)
    return null
  }
  return data as string
}

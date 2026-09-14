import { createClient } from '@/lib/supabase-server'

// ── Cierre mensual — control de período contable ─────────────────────────────
// Antes no existía ningún bloqueo: se podía crear o editar una venta, un gasto,
// un abono, etc. con fecha de un mes ya reportado, y el Estado de Resultados de
// ese mes cambiaba en silencio. Esta función es el punto único que decide si un
// período ya está cerrado; se usa como guardia al inicio de cada acción que
// escribe un movimiento con fecha (o período) contable.

export function periodoDeFecha(fecha: string): string {
  return (fecha || '').slice(0, 7) // 'YYYY-MM'
}

export async function periodoCerrado(fechaOPeriodo: string): Promise<boolean> {
  if (!fechaOPeriodo) return false
  const periodo = periodoDeFecha(fechaOPeriodo)
  if (!/^\d{4}-\d{2}$/.test(periodo)) return false
  const sb = await createClient()
  const { data } = await sb.from('disabi_cierres_mensuales').select('id').eq('periodo', periodo).maybeSingle()
  return !!data
}

// Retorna un mensaje de error si el período de esa fecha ya está cerrado, o null si se puede escribir.
// Se usa así: `const bloqueo = await bloqueadoPorCierre(fecha); if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 })`
export async function bloqueadoPorCierre(fechaOPeriodo: string): Promise<string | null> {
  if (await periodoCerrado(fechaOPeriodo)) {
    const periodo = periodoDeFecha(fechaOPeriodo)
    return `El período ${periodo} ya está cerrado contablemente. No se pueden crear ni modificar movimientos con esa fecha — reabre el mes desde Finanzas si necesitas corregir algo.`
  }
  return null
}

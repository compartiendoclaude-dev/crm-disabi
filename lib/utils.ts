import { LIQUIDACION_PCT, PAQUETERAS } from './constants'
import type { MetodoPago } from './types'

// ─── Formato moneda ───────────────────────────────────────────────────────────
export function fmtUSD(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '$0.00'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// ─── Fecha ISO hoy ────────────────────────────────────────────────────────────
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ─── Calcular fecha de vencimiento ────────────────────────────────────────────
export function calcFechaVence(desde: string, dias: number): string {
  const d = new Date(desde)
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

// ─── Calcular fecha de pago paquetera (5 días hábiles) ───────────────────────
export function calcFechaPagoPaquetera(fechaRecoleccion: string | null | undefined): string | null {
  if (!fechaRecoleccion) return null
  const d = new Date(fechaRecoleccion)
  let diasHabiles = 0
  while (diasHabiles < 5) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) diasHabiles++
  }
  return d.toISOString().slice(0, 10)
}

// ─── Número de año-mes actual ─────────────────────────────────────────────────
export function nowYM(): string {
  return new Date().toISOString().slice(0, 7)
}

// ─── Etiqueta de mes (2026-06 → Jun 2026) ────────────────────────────────────
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${months[parseInt(m) - 1]} ${y}`
}

// ─── Liquidación Link de Pago / Pago POS ─────────────────────────────────────
export interface Liquidacion {
  montoNeto: number
  ivaPercibido: number
  comision: number
  ivaComision: number
  montoLiquido: number
  comisionPct: number
}

export function calcLiquidacion(valorTotal: number, metodoPago: MetodoPago): Liquidacion | null {
  const pct = LIQUIDACION_PCT[metodoPago]
  if (!pct) return null
  const montoNeto    = valorTotal / 1.13
  const ivaPercibido = parseFloat((montoNeto * 0.02).toFixed(2))
  const comision     = parseFloat((valorTotal * pct / 100).toFixed(2))
  const ivaComision  = parseFloat((comision * 0.13).toFixed(2))
  const montoLiquido = parseFloat((valorTotal - ivaPercibido - comision - ivaComision).toFixed(2))
  return { montoNeto, ivaPercibido, comision, ivaComision, montoLiquido, comisionPct: pct }
}

// ─── Comisión paquetera ───────────────────────────────────────────────────────
export function calcComisionPaquetera(
  paqueteraKey: string,
  monto: number,
  esContraentrega: boolean
): { costoEnvio: number; comisionMonto: number; montoNeto: number } {
  const paq = PAQUETERAS[paqueteraKey as keyof typeof PAQUETERAS]
  if (!paq) return { costoEnvio: 0, comisionMonto: 0, montoNeto: monto }
  const comisionMonto = esContraentrega
    ? parseFloat((monto * paq.comisionPct / 100).toFixed(2))
    : 0
  return {
    costoEnvio: paq.costoEnvio,
    comisionMonto,
    montoNeto: parseFloat((monto - paq.costoEnvio - comisionMonto).toFixed(2)),
  }
}

// ─── Inferir estado_cobro desde método de pago ───────────────────────────────
export function inferirEstadoCobro(
  metodoPago: MetodoPago,
  esBorrador: boolean
): string {
  if (esBorrador) return 'Borrador'
  if (metodoPago === 'Credito') return 'Pendiente'
  if (metodoPago === 'Link de Pago' || metodoPago === 'Pago POS') return 'Liquidacion_Pendiente'
  return 'Cobrado' // Efectivo | Transferencia
}

// ─── Truncar texto ────────────────────────────────────────────────────────────
export function truncate(str: string, n: number): string {
  return str.length > n ? str.slice(0, n) + '…' : str
}

// ─── Días entre dos fechas ────────────────────────────────────────────────────
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

// ─── Segundo lunes hábil del mes ─────────────────────────────────────────────
// Regla DISABI: pago de comisiones el 2do lunes hábil del mes
// Si ese día es asueto, se mueve al siguiente día hábil
// ─── Asuetos El Salvador (MM-DD) ─────────────────────────────────────────────
// Aplica a cualquier año: si el día cae en estas fechas, se mueve al siguiente hábil
const ASUETOS_SV = new Set([
  '01-01', // Año Nuevo
  '04-10', // Jueves Santo (aproximado — en código real sería calculado)
  '04-11', // Viernes Santo
  '05-01', // Día del Trabajo
  '06-17', // Día del Padre (El Salvador)
  '08-04', // Festividades Agostinas
  '08-05', // Festividades Agostinas
  '09-15', // Independencia
  '11-02', // Día de los Difuntos
  '12-25', // Navidad
  '12-31', // Fin de año
])

function esAsueto(fecha: Date): boolean {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0')
  const dd = String(fecha.getDate()).padStart(2, '0')
  return ASUETOS_SV.has(`${mm}-${dd}`)
}

function esDiaHabil(fecha: Date): boolean {
  const dow = fecha.getDay()
  if (dow === 0 || dow === 6) return false // fin de semana
  if (esAsueto(fecha)) return false
  return true
}

export function segundoLunesHabil(anio: number, mes: number): string {
  let lunes = 0
  let dia = 1
  const diasEnMes = new Date(anio, mes, 0).getDate()
  let fechaSegundoLunes: Date | null = null

  while (dia <= diasEnMes) {
    const d = new Date(anio, mes - 1, dia)
    if (d.getDay() === 1) { // es lunes
      lunes++
      if (lunes === 2) {
        fechaSegundoLunes = d
        break
      }
    }
    dia++
  }

  if (!fechaSegundoLunes) return new Date(anio, mes - 1, 1).toISOString().slice(0, 10)

  // Si el segundo lunes es asueto, mover al siguiente día hábil
  while (!esDiaHabil(fechaSegundoLunes)) {
    fechaSegundoLunes.setDate(fechaSegundoLunes.getDate() + 1)
  }

  return fechaSegundoLunes.toISOString().slice(0, 10)
}

// ─── ISR sobre comisiones para empleados en planilla ─────────────────────────
// Comisiones son ingresos adicionales — se aplica retención mensual simplificada
// usando la misma tabla progresiva del salario
export function calcISRComision(montoComision: number): number {
  // Aplicar tabla de retención Art. 154 LISR sobre el monto de comisión
  const anual = montoComision * 12
  if (anual <= 4064)    return 0
  if (anual <= 9142.86) return parseFloat((Math.max(0, (montoComision - 338.67) * 0.10)).toFixed(2))
  if (anual <= 22857.14) return parseFloat((Math.max(0, (montoComision - 761.92) * 0.20)).toFixed(2))
  return parseFloat((Math.max(0, (montoComision - 1904.76) * 0.30)).toFixed(2))
}

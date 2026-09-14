import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
// Importar el módulo interno directamente evita un bug conocido de pdf-parse v1.1.1
// donde index.js ejecuta código de prueba (busca un PDF de ejemplo) cuando Next.js
// analiza el módulo en build time, rompiendo el build con ENOENT.
// @ts-expect-error — pdf-parse/lib no trae tipos propios; el import de nivel superior sí los tiene pero dispara el bug
import pdfParse from 'pdf-parse/lib/pdf-parse.js'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 30
}

interface MovParsed {
  fecha: string
  descripcion: string
  monto: number
  tipo: 'credito' | 'debito'
}

// ── Parser de texto plano — sin IA, determinístico, gratis ──────────────────
// Formato Davivienda El Salvador: FECHA [COMPROBANTE] CONCEPTO CARGOS ABONOS SALDO
// Todas las líneas de movimiento terminan en 3 números (cargo, abono, saldo)
function parseDavivienda(text: string, anioReferencia: number): MovParsed[] {
  const lines = text.split('\n')
  // día/mes + comprobante opcional + concepto + 3 montos (formato #,###.## o .##)
  const pattern = /^\s*(\d{1,2})\/(\d{2})\s+(?:(\d+)\s+)?(.+?)\s+([\d,]+\.\d{2}|\.\d{2})\s+([\d,]+\.\d{2}|\.\d{2})\s+([\d,]+\.\d{2}|\.\d{2})\s*$/

  const toFloat = (s: string) => parseFloat(s.replace(/,/g, ''))
  const seen = new Set<string>()
  const movimientos: MovParsed[] = []

  for (const line of lines) {
    const m = line.match(pattern)
    if (!m) continue
    const [, dia, mes, , conceptoRaw, cargoStr, abonoStr] = m
    const concepto = conceptoRaw.replace(/\s+/g, ' ').trim()
    const cargo = toFloat(cargoStr)
    const abono = toFloat(abonoStr)
    const fecha = `${anioReferencia}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`

    // Deduplicar: el PDF repite encabezados de tabla en cada página,
    // pero nunca repite la misma combinación exacta fecha+concepto+montos
    const key = `${fecha}|${concepto}|${cargo}|${abono}`
    if (seen.has(key)) continue
    seen.add(key)

    if (cargo > 0) {
      movimientos.push({ fecha, descripcion: concepto, monto: cargo, tipo: 'debito' })
    } else if (abono > 0) {
      movimientos.push({ fecha, descripcion: concepto, monto: abono, tipo: 'credito' })
    }
  }

  return movimientos
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const body = await req.json()
    const { fileBase64, anio } = body

    if (!fileBase64)
      return NextResponse.json({ error: 'Archivo PDF requerido' }, { status: 400 })

    // pdf-parse extrae el texto plano del PDF — sin IA, sin costo
    const buffer = Buffer.from(fileBase64, 'base64')
    const data = await pdfParse(buffer)

    const anioRef = anio || new Date().getFullYear()
    const movimientos = parseDavivienda(data.text, anioRef)

    if (!movimientos.length) {
      return NextResponse.json({
        error: 'No se pudo extraer movimientos con el formato conocido. Verifica que sea un estado de cuenta de Davivienda con capa de texto (no escaneado).',
      }, { status: 422 })
    }

    return NextResponse.json({ ok: true, movimientos, metodo: 'parser_texto', costo_usd: 0 })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error al procesar el PDF'
    console.error('[api/estado-cuenta]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

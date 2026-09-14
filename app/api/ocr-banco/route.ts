import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 20
}

// Precios Claude Sonnet 4.6 (por millón de tokens) — para calcular costo real de la llamada
const PRECIO_INPUT_POR_MILLON = 3.00
const PRECIO_OUTPUT_POR_MILLON = 15.00

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const body = await req.json()
    const { fileBase64, mediaType } = body

    if (!fileBase64 || !mediaType)
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })

    const esPdf = mediaType === 'application/pdf'
    const contentBlock = esPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: `Eres un asistente contable. Analiza este estado de cuenta bancario y extrae TODOS los movimientos (depósitos, retiros, cargos, transferencias, comisiones).

REGLAS:
1. Cada movimiento debe tener: fecha (YYYY-MM-DD), descripción exacta tal como aparece, monto (siempre positivo), y tipo ("credito" si es depósito/ingreso al banco, "debito" si es retiro/cargo/pago)
2. No inventes movimientos ni omitas ninguno — extrae la tabla completa línea por línea
3. Ignora encabezados, totales, saldos parciales — solo movimientos individuales
4. Si el documento tiene el nombre del banco y número de cuenta, inclúyelos
5. Responde SOLO con JSON válido, sin texto adicional, sin backticks

Formato requerido exacto:
{
  "banco": "nombre del banco o null",
  "cuenta": "número de cuenta (últimos 4 dígitos está bien) o null",
  "periodo": "mes/año del estado o null",
  "movimientos": [
    {"fecha": "2026-06-15", "descripcion": "DEPOSITO TRANSFERENCIA", "monto": 500.00, "tipo": "credito"}
  ]
}`,
            },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err?.error?.message ?? `Error de API Anthropic (${res.status})`)
    }

    const data = await res.json()
    const texto = data?.content?.[0]?.text ?? ''
    const clean = texto.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    // Costo real de esta llamada, calculado con el uso reportado por Anthropic
    const usage = data?.usage ?? {}
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const costoUSD = (inputTokens / 1_000_000 * PRECIO_INPUT_POR_MILLON)
      + (outputTokens / 1_000_000 * PRECIO_OUTPUT_POR_MILLON)

    return NextResponse.json({
      ok: true,
      ...parsed,
      _costo: { inputTokens, outputTokens, usd: parseFloat(costoUSD.toFixed(4)) },
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    console.error('[api/ocr-banco]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

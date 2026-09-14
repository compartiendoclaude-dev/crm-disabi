import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 20
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const body = await req.json()
    const { fileBase64, mediaType, catalogo } = body

    if (!fileBase64 || !mediaType)
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })

    // Claude Vision soporta imágenes directamente. Para PDF usamos type: "document"
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
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: `Eres un asistente de compras. Analiza este documento (factura o pedido de mercadería) y extrae TODOS los productos con sus cantidades.

CATÁLOGO DISPONIBLE (id | código | nombre | costo):
${catalogo}

REGLAS CRÍTICAS:
1. El campo "descripcion" es SOLO el nombre del producto — NUNCA incluyas números, cantidades ni caracteres extra en ese campo
2. La cantidad va ÚNICAMENTE en el campo "cantidad" como número
3. Si el documento tiene "cajas" y cada caja indica una cantidad de unidades (ej: "cajas de 10"), multiplica y reporta el TOTAL DE UNIDADES, no de cajas
4. Haz match con el catálogo por nombre o código e incluye el producto_id EXACTO del catálogo cuando encuentres coincidencia
5. Si no hay match en el catálogo, deja producto_id como null y usa el nombre limpio en descripcion
6. Usa el costo del catálogo si hay match; si no, usa $4.25 para sabores, $12.50 para salsas
7. Ignora columnas de comentarios, etiquetas o notas — solo interesa producto y cantidad
8. También extrae: proveedor (si aparece), fecha del documento, número de factura/orden (si aparece)
9. Responde SOLO con JSON válido, sin texto adicional, sin backticks

Formato requerido exacto:
{
  "proveedor": "nombre del proveedor o null",
  "fecha": "YYYY-MM-DD o null",
  "numero_factura": "numero o null",
  "items": [
    {"producto_id": "id-exacto-del-catalogo-o-null", "descripcion": "Nombre Producto", "cantidad": 10, "precio_unitario": 4.25, "subtotal": 42.50}
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

    return NextResponse.json({ ok: true, ...parsed })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    console.error('[api/ocr]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

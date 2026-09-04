import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import JSZip from 'jszip'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(10) // ZIP imports son pesados — muy restrictivo

// ─── Mismo parser que /api/dte/route.ts ───────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDteJson(json: any, nombreArchivo: string) {
  const id  = json?.identificacion ?? {}
  const em  = json?.emisor         ?? {}
  const re  = json?.receptor       ?? {}
  const res = json?.resumen        ?? {}

  const numeroControl    = id.numeroControl    ?? id.numControl      ?? ''
  const codigoGeneracion = id.codigoGeneracion ?? id.uuid            ?? ''
  const tipoDte          = id.tipoDte          ?? id.tipo            ?? '01'
  const fechaEmision     = id.fecEmi           ?? id.fechaEmision    ?? ''
  const horaEmision      = id.horEmi           ?? id.horaEmision     ?? null
  const selloRecepcion   = json?.respuestaMH?.selloRecibido ?? json?.selloRecibido ?? null
  const ambiente         = id.ambiente ?? '01'
  const estado: string   = selloRecepcion ? 'PROCESADO' : 'IMPORTADO'

  const receptorNombre  = re.nombre         ?? re.nombreComercial ?? ''
  const receptorNit     = re.nit            ?? re.numDocumento    ?? null
  const receptorNrc     = re.nrc            ?? null
  const receptorTipoDoc = re.tipoDocumento  ?? null
  const emisorNit       = em.nit            ?? null
  const emisorNombre    = em.nombre         ?? em.nombreComercial ?? null
  const emisorNrc       = em.nrc            ?? null

  const totalNoSujeto = Number(res.totalNoSuj    ?? res.totalNoSujeto    ?? 0)
  const totalExento   = Number(res.totalExenta   ?? res.totalExento      ?? 0)
  const totalGravado  = Number(res.totalGravada  ?? res.totalGravado     ?? 0)
  const subTotal      = Number(res.subTotal      ?? res.subTotalVentas   ?? 0)
  const ivaRetenido   = Number(res.ivaRete1      ?? res.ivaRetenido      ?? 0)
  const totalPagar    = Number(res.totalPagar    ?? res.montoTotalOperacion ?? 0)

  if (!numeroControl)    throw new Error(`Sin numeroControl`)
  if (!codigoGeneracion) throw new Error(`Sin codigoGeneracion`)
  if (!fechaEmision)     throw new Error(`Sin fecha de emisión`)

  return {
    tipo_dte: tipoDte, numero_control: numeroControl, codigo_generacion: codigoGeneracion,
    sello_recepcion: selloRecepcion, emisor_nit: emisorNit, emisor_nombre: emisorNombre,
    emisor_nrc: emisorNrc, receptor_nombre: receptorNombre, receptor_nit: receptorNit,
    receptor_nrc: receptorNrc, receptor_tipo_doc: receptorTipoDoc, fecha_emision: fechaEmision,
    hora_emision: horaEmision, total_no_sujeto: totalNoSujeto, total_exento: totalExento,
    total_gravado: totalGravado, sub_total: subTotal, iva_retenido: ivaRetenido,
    total_pagar: totalPagar, estado, ambiente, json_original: json,
    archivo_origen: nombreArchivo,
  }
}

// ─── POST — recibe ZIP, responde con SSE ──────────────────────────────────────
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  const sb = await createClient()

  // Leer el ZIP del body (multipart)
  let zipBuffer: Buffer
  try {
    const formData = await req.formData()
    const file = formData.get('zip') as File | null
    if (!file) return NextResponse.json({ error: 'No se recibió archivo ZIP' }, { status: 400 })
    const arrayBuffer = await file.arrayBuffer()
    zipBuffer = Buffer.from(arrayBuffer)
  } catch {
    return NextResponse.json({ error: 'Error leyendo el archivo' }, { status: 400 })
  }

  // Descomprimir
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipBuffer)
  } catch {
    return NextResponse.json({ error: 'Archivo ZIP inválido o corrupto' }, { status: 400 })
  }

  // Recolectar todos los .json del ZIP (cualquier subcarpeta)
  const jsonFiles: { path: string; file: JSZip.JSZipObject }[] = []
  zip.forEach((path, file) => {
    if (!file.dir && path.toLowerCase().endsWith('.json') && !path.includes('__MACOSX')) {
      jsonFiles.push({ path, file })
    }
  })

  if (!jsonFiles.length) {
    return NextResponse.json({ error: 'El ZIP no contiene archivos .json' }, { status: 400 })
  }

  // ── Respuesta SSE para progreso en tiempo real ─────────────────────────────
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      send({ type: 'start', total: jsonFiles.length })

      let exitosos = 0
      const duplicados = 0
      let fallidos = 0
      const errores: { archivo: string; error: string }[] = []

      // Procesar en lotes de 50 para no sobrecargar Supabase
      const BATCH = 50
      for (let i = 0; i < jsonFiles.length; i += BATCH) {
        const lote = jsonFiles.slice(i, i + BATCH)
        const registros: ReturnType<typeof parseDteJson>[] = []
        const loteErrores: { archivo: string; error: string }[] = []

        // Parsear lote
        for (const { path, file } of lote) {
          try {
            const text = await file.async('string')
            const json = JSON.parse(text)
            registros.push(parseDteJson(json, path))
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'JSON inválido'
            loteErrores.push({ archivo: path, error: msg })
            fallidos++
          }
        }

        // Upsert lote en Supabase
        if (registros.length) {
          const { error, data } = await sb
            .from('disabi_dte')
            .upsert(registros, { onConflict: 'codigo_generacion', ignoreDuplicates: false })
            .select('id')

          if (error) {
            // Si falla el lote entero, marcar todos como error
            for (const r of registros) {
              loteErrores.push({ archivo: r.archivo_origen ?? '', error: error.message })
              fallidos++
            }
          } else {
            exitosos += data?.length ?? registros.length
          }
        }

        errores.push(...loteErrores)

        // Enviar progreso
        send({
          type: 'progress',
          procesados: Math.min(i + BATCH, jsonFiles.length),
          total: jsonFiles.length,
          exitosos,
          duplicados,
          fallidos,
          pct: Math.round(Math.min(i + BATCH, jsonFiles.length) / jsonFiles.length * 100),
        })
      }

      // Resumen final
      send({
        type: 'done',
        total: jsonFiles.length,
        exitosos,
        duplicados,
        fallidos,
        errores: errores.slice(0, 50), // máximo 50 errores en respuesta
      })

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  })
}

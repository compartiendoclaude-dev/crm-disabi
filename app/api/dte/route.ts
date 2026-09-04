import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'

const rateLimit = makeRateLimiter(60)

// ─── Extrae campos estandarizados del JSON DTE MH ─────────────────────────────
// El JSON del MH tiene estructura: { identificacion, emisor, receptor, resumen, ... }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseDteJson(json: any, nombreArchivo: string) {
  const id   = json?.identificacion ?? {}
  const em   = json?.emisor ?? {}
  const re   = json?.receptor ?? {}
  const res  = json?.resumen ?? {}

  // Número de control: puede estar en id.numeroControl o id.numControl
  const numeroControl   = id.numeroControl   ?? id.numControl   ?? ''
  const codigoGeneracion = id.codigoGeneracion ?? id.uuid        ?? ''
  const tipoDte          = id.tipoDte         ?? id.tipo         ?? '01'
  const fechaEmision     = id.fecEmi          ?? id.fechaEmision ?? ''
  const horaEmision      = id.horEmi          ?? id.horaEmision  ?? null

  const selloRecepcion   = json?.respuestaMH?.selloRecibido ?? json?.selloRecibido ?? null
  const ambiente         = id.ambiente ?? '01'
  const estado: string   = selloRecepcion ? 'PROCESADO' : 'IMPORTADO'

  // Receptor
  const receptorNombre  = re.nombre         ?? re.nombreComercial ?? ''
  const receptorNit     = re.nit            ?? re.numDocumento     ?? null
  const receptorNrc     = re.nrc            ?? null
  const receptorTipoDoc = re.tipoDocumento  ?? null

  // Emisor
  const emisorNit    = em.nit           ?? null
  const emisorNombre = em.nombre        ?? em.nombreComercial ?? null
  const emisorNrc    = em.nrc           ?? null

  // Montos
  const totalNoSujeto = Number(res.totalNoSuj    ?? res.totalNoSujeto    ?? 0)
  const totalExento   = Number(res.totalExenta   ?? res.totalExento      ?? 0)
  const totalGravado  = Number(res.totalGravada  ?? res.totalGravado     ?? 0)
  const subTotal      = Number(res.subTotal      ?? res.subTotalVentas   ?? 0)
  const ivaRetenido   = Number(res.ivaRete1      ?? res.ivaRetenido      ?? 0)
  const totalPagar    = Number(res.totalPagar    ?? res.montoTotalOperacion ?? 0)

  if (!numeroControl)    throw new Error(`El archivo "${nombreArchivo}" no tiene numeroControl`)
  if (!codigoGeneracion) throw new Error(`El archivo "${nombreArchivo}" no tiene codigoGeneracion`)
  if (!fechaEmision)     throw new Error(`El archivo "${nombreArchivo}" no tiene fecha de emisión`)

  return {
    tipo_dte:          tipoDte,
    numero_control:    numeroControl,
    codigo_generacion: codigoGeneracion,
    sello_recepcion:   selloRecepcion,
    emisor_nit:        emisorNit,
    emisor_nombre:     emisorNombre,
    emisor_nrc:        emisorNrc,
    receptor_nombre:   receptorNombre,
    receptor_nit:      receptorNit,
    receptor_nrc:      receptorNrc,
    receptor_tipo_doc: receptorTipoDoc,
    fecha_emision:     fechaEmision,
    hora_emision:      horaEmision,
    total_no_sujeto:   totalNoSujeto,
    total_exento:      totalExento,
    total_gravado:     totalGravado,
    sub_total:         subTotal,
    iva_retenido:      ivaRetenido,
    total_pagar:       totalPagar,
    estado,
    ambiente,
    json_original:     json,
    archivo_origen:    nombreArchivo,
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb   = await createClient()
    const body = await req.json()
    const { action } = body

    // ── Importar uno o múltiples DTE desde JSON ────────────────────────────────
    if (action === 'import_dte') {
      const { documentos } = body as {
        documentos: { json: Record<string, unknown>; nombre: string }[]
      }

      if (!documentos?.length)
        return NextResponse.json({ error: 'No se recibieron documentos' }, { status: 400 })

      const resultados: { nombre: string; ok: boolean; numero_control?: string; error?: string }[] = []

      for (const doc of documentos) {
        try {
          const parsed = parseDteJson(doc.json, doc.nombre)

          // Upsert por codigo_generacion — evita duplicados
          const { error } = await sb
            .from('disabi_dte')
            .upsert([parsed], { onConflict: 'codigo_generacion', ignoreDuplicates: false })

          if (error) throw error
          resultados.push({ nombre: doc.nombre, ok: true, numero_control: parsed.numero_control })
        } catch (e: unknown) {
          resultados.push({
            nombre: doc.nombre,
            ok: false,
            error: e instanceof Error ? e.message : 'Error desconocido',
          })
        }
      }

      const exitosos = resultados.filter(r => r.ok).length
      const fallidos = resultados.filter(r => !r.ok).length
      return NextResponse.json({ ok: true, exitosos, fallidos, resultados })
    }

    // ── Vincular DTE a una venta existente ────────────────────────────────────
    if (action === 'vincular_venta') {
      const { dte_id, venta_id } = body
      if (!dte_id) return NextResponse.json({ error: 'dte_id requerido' }, { status: 400 })

      const { error } = await sb
        .from('disabi_dte')
        .update({ venta_id: venta_id || null })
        .eq('id', dte_id)

      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Actualizar notas ───────────────────────────────────────────────────────
    if (action === 'update_notas') {
      const { dte_id, notas } = body
      const { error } = await sb.from('disabi_dte').update({ notas }).eq('id', dte_id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Eliminar DTE ──────────────────────────────────────────────────────────
    if (action === 'delete_dte') {
      const { id } = body
      const { error } = await sb.from('disabi_dte').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/dte]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// ─── GET — exportar CSV ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const guard = await requireAuth(req, rateLimit)
  if (guard.error) return guard.error

  try {
    const sb  = await createClient()
    const url = new URL(req.url)

    if (url.searchParams.get('export') === 'csv') {
      const { data: dtes } = await sb
        .from('disabi_dte')
        .select('tipo_dte, numero_control, codigo_generacion, receptor_nombre, receptor_nit, fecha_emision, total_gravado, iva_retenido, total_pagar, estado, archivo_origen, created_at')
        .order('fecha_emision', { ascending: false })

      const TIPO_LABEL: Record<string, string> = {
        '01':'Factura (FCF)','03':'Crédito Fiscal (CCF)','05':'Nota de Crédito',
        '06':'Nota de Débito','07':'Comp. Retención','08':'Comp. Liquidación','11':'Factura Exportación',
      }

      const headers = ['Tipo','Número Control','Código Generación','Receptor','NIT Receptor',
        'Fecha Emisión','Total Gravado','IVA','Total a Pagar','Estado','Archivo','Importado']
      const rows = (dtes ?? []).map(d => [
        TIPO_LABEL[d.tipo_dte] ?? d.tipo_dte,
        d.numero_control,
        d.codigo_generacion,
        d.receptor_nombre,
        d.receptor_nit ?? '',
        d.fecha_emision,
        d.total_gravado?.toFixed(2) ?? '0.00',
        d.iva_retenido?.toFixed(2)  ?? '0.00',
        d.total_pagar?.toFixed(2)   ?? '0.00',
        d.estado,
        d.archivo_origen ?? '',
        (d.created_at ?? '').slice(0, 10),
      ])

      const csv = [headers, ...rows]
        .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
        .join('\n')

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="disabi-dte-${new Date().toISOString().slice(0,10)}.csv"`,
        },
      })
    }

    return NextResponse.json({ error: 'Parámetro no reconocido' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[api/dte GET]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

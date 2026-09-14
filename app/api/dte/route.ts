import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { makeRateLimiter, requireAuth } from '@/lib/api-security'
import { requirePermisoEscritura, tienePermisoExtra } from '@/lib/permisos-server'

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

  const body = await req.json()
  const { action } = body

  // El módulo DTE completo (Importar masivo, Cierre Mensual, eliminar, crear
  // venta genérica desde DTE) sigue siendo solo para quien tiene permiso de
  // escritura en 'dte' (admin, finanzas). La única excepción es Ventas
  // (Comercial), que con el permiso angosto "dte_venta" puede subir el DTE de
  // la venta que acaba de registrar y vincularlo — nada más.
  const tieneDte = await requirePermisoEscritura(guard.user.id, 'dte')
  if (!tieneDte) {
    const puedeDteVenta = (action === 'import_dte' || action === 'vincular_venta') &&
      (await tienePermisoExtra(guard.user.id, 'dte_venta'))
    if (!puedeDteVenta)
      return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar DTE' }, { status: 403 })
  }

  try {
    const sb = await createClient()

    // ── Importar uno o múltiples DTE desde JSON ────────────────────────────────
    if (action === 'import_dte') {
      const { documentos } = body as {
        documentos: { json: Record<string, unknown>; nombre: string }[]
      }

      if (!documentos?.length)
        return NextResponse.json({ error: 'No se recibieron documentos' }, { status: 400 })

      const resultados: { nombre: string; ok: boolean; numero_control?: string; id?: string; error?: string }[] = []

      for (const doc of documentos) {
        try {
          const parsed = parseDteJson(doc.json, doc.nombre)

          // Upsert por codigo_generacion — evita duplicados. Se pide el id
          // de vuelta porque el flujo de Ventas (subir DTE de una venta)
          // necesita vincularlo a la venta en el mismo paso.
          const { data: upserted, error } = await sb
            .from('disabi_dte')
            .upsert([parsed], { onConflict: 'codigo_generacion', ignoreDuplicates: false })
            .select('id')
            .single()

          if (error) throw error
          resultados.push({ nombre: doc.nombre, ok: true, numero_control: parsed.numero_control, id: upserted?.id })
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

    // ── Crear venta genérica desde DTE (para meses sin ventas registradas) ────
    if (action === 'crear_venta_desde_dte') {
      const { dte_id } = body
      if (!dte_id) return NextResponse.json({ error: 'dte_id requerido' }, { status: 400 })

      const { data: dte, error: dteErr } = await sb
        .from('disabi_dte')
        .select('*')
        .eq('id', dte_id)
        .single()
      if (dteErr || !dte) return NextResponse.json({ error: 'DTE no encontrado' }, { status: 404 })

      if (dte.tipo_dte === '05' || dte.tipo_dte === '06')
        return NextResponse.json({ error: 'Las Notas de Crédito/Débito no generan venta' }, { status: 400 })

      if (dte.venta_id)
        return NextResponse.json({ error: 'Este DTE ya tiene una venta vinculada', venta_id: dte.venta_id }, { status: 400 })

      const { count } = await sb.from('disabi_ventas').select('*', { count: 'exact', head: true })
      const numero = 'VTA-' + String((count ?? 0) + 1).padStart(4, '0')
      const canal = dte.tipo_dte === '03' ? 'DTE-CCF' : 'DTE-FCF'

      const { data: nuevaVenta, error: ventaErr } = await sb
        .from('disabi_ventas')
        .insert([{
          numero,
          nombre:     dte.receptor_nombre || 'Cliente DTE',
          sector:     'Distribución',
          monto:      dte.total_pagar ?? 0,
          monto_neto: dte.total_gravado ?? dte.total_pagar ?? 0,
          fecha:      dte.fecha_emision,
          cobro:      'Cobrado',
          canal,
          notas:      `Generada desde DTE ${dte.numero_control}`,
          metodo_pago: 'Efectivo',
        }])
        .select()
        .single()

      if (ventaErr || !nuevaVenta)
        throw ventaErr ?? new Error('Error al crear la venta')

      await sb.from('disabi_dte')
        .update({ venta_id: nuevaVenta.id })
        .eq('id', dte_id)

      return NextResponse.json({ ok: true, venta_id: nuevaVenta.id, numero })
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

    // ── Datos completos de un mes específico para Cierre Mensual ──────────────
    // (evita el límite de 500 documentos del listado general — filtra en BD)
    const mesParam = url.searchParams.get('mes')
    if (mesParam) {
      if (!/^\d{4}-\d{2}$/.test(mesParam))
        return NextResponse.json({ error: 'Formato de mes inválido. Use YYYY-MM' }, { status: 400 })

      const [anioNum, mesNum] = mesParam.split('-').map(Number)
      const mesInicio = mesParam + '-01'
      const mesFin = new Date(anioNum, mesNum, 0).toISOString().slice(0, 10)

      const [{ data: dtesMes }, { data: ventasMes }] = await Promise.all([
        sb.from('disabi_dte')
          .select('*, venta:disabi_ventas(numero, nombre)')
          .gte('fecha_emision', mesInicio).lte('fecha_emision', mesFin)
          .order('fecha_emision', { ascending: false }),

        sb.from('disabi_ventas')
          .select('id, numero, nombre, fecha, monto, cobro')
          .gte('fecha', mesInicio).lte('fecha', mesFin)
          .not('cobro', 'eq', 'Borrador'),
      ])

      return NextResponse.json({ ok: true, dtes: dtesMes ?? [], ventas: ventasMes ?? [] })
    }

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

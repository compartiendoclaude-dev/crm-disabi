import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { calcLiquidacion, calcFechaVence, calcFechaPagoPaquetera, inferirEstadoCobro } from '@/lib/utils'
import { PAQUETERAS } from '@/lib/constants'
import type { MetodoPago } from '@/lib/types'

// ── Rate limit simple por IP ──────────────────────────────────────────────────
const hits = new Map<string, number[]>()
function rateLimit(ip: string): boolean {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now)
  hits.set(ip, prev)
  return prev.length <= 60
}

// ── Validar sesión ────────────────────────────────────────────────────────────
async function getUser() {
  const sb = await createClient()
  const { data: { user }, error } = await sb.auth.getUser()
  if (error || !user) return null
  return user
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const sb  = await createClient()
  const body = await req.json()
  const { action } = body

  try {
    // ── VENTA: guardar ──────────────────────────────────────────────────────
    if (action === 'save_venta') {
      const {
        editId, nombre, fecha, sector, canal, notas,
        vendedorId,
        metodoPago, esBorrador, diasCredito, credito5050,
        conPaquetera, paqueteraKey, paqueteraNombre: paqNombreCustom,
        paqueteraCosto: paqCostoCustom, paqueteraComision: paqComPct,
        paqCobroCliente,
        fechaRecoleccion, items,
      } = body

      if (!nombre?.trim()) return NextResponse.json({ error: 'Cliente requerido' }, { status: 400 })
      if (!items?.length)  return NextResponse.json({ error: 'Agrega al menos un producto' }, { status: 400 })

      const monto = items.reduce((a: number, i: { subtotal: number }) => a + i.subtotal, 0)
      const cobro = inferirEstadoCobro(metodoPago as MetodoPago, esBorrador)

      // Paquetera
      let paqNombre = '', paqCosto = 0, paqComPctVal = 0, paqComMonto = 0
      if (paqueteraKey && PAQUETERAS[paqueteraKey as keyof typeof PAQUETERAS]) {
        const p = PAQUETERAS[paqueteraKey as keyof typeof PAQUETERAS]
        paqNombre   = p.nombre
        paqCosto    = p.costoEnvio
        paqComPctVal = p.comisionPct
      } else if (paqNombreCustom) {
        paqNombre    = paqNombreCustom
        paqCosto     = paqCostoCustom ?? 0
        paqComPctVal = paqComPct ?? 0
      }
      if (paqNombre && conPaquetera) {
        paqComMonto = parseFloat((monto * paqComPctVal / 100).toFixed(2))
      }

      // Liquidación
      const liq = calcLiquidacion(monto, metodoPago as MetodoPago)

      // Monto neto
      let montoNeto = monto
      if (paqNombre) montoNeto = parseFloat((monto - paqCosto - paqComMonto).toFixed(2))
      if (liq)       montoNeto = liq.montoLiquido

      // Siguiente número
      let numero: string | undefined
      if (!editId) {
        const { count } = await sb.from('disabi_ventas').select('*', { count: 'exact', head: true })
        numero = 'VTA-' + String((count ?? 0) + 1).padStart(4, '0')
      }

      const obj = {
        ...(numero ? { numero } : {}),
        nombre: nombre.trim(),
        sector: sector || null,
        plan: 'Venta directa',
        monto,
        monto_neto: montoNeto,
        metodo_pago: metodoPago,
        con_paquetera_efectivo: !!conPaquetera,
        credito_50_50: metodoPago === 'Credito' ? !!credito5050 : false,
        paquetera: paqNombre || null,
        paquetera_costo: paqCosto || null,
        paquetera_comision: paqComPctVal || null,
        paquetera_com_monto:      paqComMonto || null,
        paquetera_cobro_cliente:  paqCobroCliente ?? null,
        fecha_recoleccion: paqNombre ? (fechaRecoleccion || null) : null,
        fecha_pago_paquetera: paqNombre ? calcFechaPagoPaquetera(fechaRecoleccion) : null,
        liq_iva_percibido:  liq?.ivaPercibido  ?? null,
        liq_comision:       liq?.comision       ?? null,
        liq_iva_comision:   liq?.ivaComision    ?? null,
        liq_monto_liquido:  liq?.montoLiquido   ?? null,
        fecha,
        cobro,
        canal: canal || 'Mostrador',
        notas: notas || null,
        vendedor_id: vendedorId || null,
      }

      let ventaId: string
      if (editId) {
        const { error } = await sb.from('disabi_ventas').update(obj).eq('id', editId)
        if (error) throw error
        await sb.from('disabi_venta_items').delete().eq('venta_id', editId)
        ventaId = editId
      } else {
        const { data, error } = await sb.from('disabi_ventas').insert([obj]).select().single()
        if (error) throw error
        ventaId = data.id
      }

      // Items
      const itemsToInsert = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct?: number; subtotal: number }) => ({
        venta_id:        ventaId,
        producto_id:     i.producto_id || null,
        cantidad:        i.cantidad,
        precio_unitario: i.precio_unitario,
        descuento:       i.descuento_pct ?? 0,
        subtotal:        i.subtotal,
      }))
      const { error: itemErr } = await sb.from('disabi_venta_items').insert(itemsToInsert)
      if (itemErr) throw itemErr

      // Descontar stock y registrar Kardex solo en ventas NUEVAS (no en ediciones)
      // En edición: el stock ya fue descontado en el insert original
      if (!esBorrador && !editId) {
        for (const item of items.filter((i: { producto_id?: string }) => i.producto_id)) {
          const { data: prodStock } = await sb.from('disabi_productos')
            .select('stock_actual').eq('id', item.producto_id).single()
          if (prodStock) {
            const nuevoStock = Math.max(0, prodStock.stock_actual - item.cantidad)
            await sb.from('disabi_productos')
              .update({ stock_actual: nuevoStock })
              .eq('id', item.producto_id)
            // Kardex: registrar salida por venta
            await sb.from('disabi_movimientos_inv').insert([{
              producto_id:   item.producto_id,
              tipo:          'Salida',  // capitalización consistente con 'Entrada'
              cantidad:      item.cantidad,
              stock_antes:   prodStock.stock_actual,
              stock_despues: nuevoStock,
              referencia:    numero ?? ventaId,
              motivo:        `Venta ${numero ?? ventaId} — ${nombre.trim()}`,
              fecha:         fecha,
            }])
          }
        }
      }

      // Si es Crédito → crear Pendiente de Pago automático
      if (cobro === 'Pendiente' && !editId) {
        const fechaVence = calcFechaVence(fecha, diasCredito ?? 30)
        const { count: ppCount } = await sb.from('disabi_cotizaciones')
          .select('*', { count: 'exact', head: true })
        const ppNum = 'PP-' + String((ppCount ?? 0) + 1).padStart(4, '0')
        const ppObj = {
          numero: ppNum, tipo: 'Pendiente de Pago',
          cliente: nombre.trim(),
          fecha_emision: fecha,
          fecha_entrega: fechaVence,
          subtotal: monto, descuento_pct: 0, descuento_monto: 0,
          impuesto_pct: 0, impuesto_monto: 0, total: monto,
          estado: 'Pendiente',
          sector: sector || null,
          condiciones_pago: (diasCredito ?? 30) + ' días',
          metodo_pago: 'Credito',
          dias_credito: diasCredito ?? 30,
          credito_50_50: !!credito5050,
          notas_internas: 'venta_id:' + ventaId,
        }
        const { data: ppData, error: ppErr } = await sb.from('disabi_cotizaciones').insert([ppObj]).select().single()
        if (!ppErr && ppData) {
          const ppItems = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct?: number; subtotal: number }) => ({
            cotizacion_id:   ppData.id,
            producto_id:     i.producto_id || null,
            cantidad:        i.cantidad,
            precio_unitario: i.precio_unitario,
            descuento:       i.descuento_pct ?? 0,
            subtotal:        i.subtotal,
          }))
          await sb.from('disabi_cotizacion_items').insert(ppItems)
        }
      }

      return NextResponse.json({ ok: true, id: ventaId, cobro })
    }

    // ── VENTA: eliminar ─────────────────────────────────────────────────────
    if (action === 'delete_venta') {
      const { id } = body

      // Leer la venta para saber si era activa (no Borrador)
      const { data: ventaAEliminar } = await sb.from('disabi_ventas')
        .select('cobro').eq('id', id).single()

      // Leer items para revertir stock
      const { data: itemsARevertir } = await sb.from('disabi_venta_items')
        .select('producto_id, cantidad').eq('venta_id', id)

      // Revertir stock si la venta no era Borrador
      if (ventaAEliminar?.cobro !== 'Borrador' && itemsARevertir?.length) {
        for (const item of itemsARevertir.filter(i => i.producto_id)) {
          const { data: prod } = await sb.from('disabi_productos')
            .select('stock_actual').eq('id', item.producto_id).single()
          if (prod) {
            const stockRestaurado = prod.stock_actual + item.cantidad
            await sb.from('disabi_productos')
              .update({ stock_actual: stockRestaurado })
              .eq('id', item.producto_id)
            await sb.from('disabi_movimientos_inv').insert([{
              producto_id:   item.producto_id,
              tipo:          'Entrada',
              cantidad:      item.cantidad,
              stock_antes:   prod.stock_actual,
              stock_despues: stockRestaurado,
              motivo:        `Reversión por eliminación de venta ${id}`,
              fecha:         new Date().toISOString().slice(0, 10),
            }])
          }
        }
      }

      await sb.from('disabi_venta_items').delete().eq('venta_id', id)
      const { error } = await sb.from('disabi_ventas').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── VENTA: confirmar liquidación ────────────────────────────────────────
    if (action === 'confirmar_liquidacion') {
      const { id } = body
      const { error } = await sb.from('disabi_ventas').update({ cobro: 'Cobrado' }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── COTIZACIÓN: guardar ─────────────────────────────────────────────────
    if (action === 'save_cotizacion') {
      const { editId, tipo, ...fields } = body
      const metodoPago = fields.metodo_pago
      const diasCredito = fields.dias_credito
      const condicionesPago = metodoPago === 'Credito'
        ? (diasCredito + ' días')
        : metodoPago

      let numero: string | undefined
      if (!editId) {
        const { count } = await sb.from('disabi_cotizaciones')
          .select('*', { count: 'exact', head: true })
          .eq('tipo', tipo)
        const prefix = tipo === 'Cotizacion' ? 'COT' : tipo === 'Orden de Venta' ? 'OV' : 'PP'
        numero = prefix + '-' + String((count ?? 0) + 1).padStart(4, '0')
      }

      const SAFE = ['cliente','contacto','email','telefono','fecha_emision','fecha_vence',
        'fecha_entrega','subtotal','descuento_pct','descuento_monto','impuesto_pct',
        'impuesto_monto','envio_monto','direccion_envio','gran_contribuyente',
        'retencion_monto','total','estado','sector','notas','notas_internas',
        'metodo_pago','dias_credito','credito_50_50']
      const obj: Record<string, unknown> = { tipo, condiciones_pago: condicionesPago }
      if (numero) obj.numero = numero
      SAFE.forEach(k => { if (fields[k] !== undefined) obj[k] = fields[k] })

      const { items, ..._ } = fields
      void _

      let cotId: string
      if (editId) {
        const { error } = await sb.from('disabi_cotizaciones').update(obj).eq('id', editId)
        if (error) throw error
        await sb.from('disabi_cotizacion_items').delete().eq('cotizacion_id', editId)
        cotId = editId
      } else {
        const { data, error } = await sb.from('disabi_cotizaciones').insert([obj]).select().single()
        if (error) throw error
        cotId = data.id
      }

      if (items?.length) {
        const cotItems = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct?: number; subtotal: number }, idx: number) => ({
          cotizacion_id: cotId,
          producto_id:   i.producto_id || null,
          descripcion:   i.descripcion,
          cantidad:      i.cantidad,
          precio_unitario: i.precio_unitario,
          descuento_pct: i.descuento_pct ?? 0,
          subtotal:      i.subtotal,
          orden:         idx,
        }))
        const { error: iErr } = await sb.from('disabi_cotizacion_items').insert(cotItems)
        if (iErr) throw iErr
      }

      return NextResponse.json({ ok: true, id: cotId })
    }

    // ── COTIZACIÓN: eliminar ────────────────────────────────────────────────
    if (action === 'delete_cotizacion') {
      const { id } = body
      await sb.from('disabi_cotizacion_items').delete().eq('cotizacion_id', id)
      const { error } = await sb.from('disabi_cotizaciones').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── PP: marcar pagado ───────────────────────────────────────────────────
    if (action === 'pagar_pp') {
      const { id, fecha_pago } = body
      const fp = fecha_pago || new Date().toISOString().slice(0, 10)

      // Leer el PP para obtener cliente y monto
      const { data: pp } = await sb.from('disabi_cotizaciones')
        .select('cliente, total, notas_internas').eq('id', id).single()
      if (!pp) return NextResponse.json({ error: 'PP no encontrado' }, { status: 404 })

      // Marcar el PP como pagado
      const { error } = await sb.from('disabi_cotizaciones')
        .update({ estado: 'Pagado' }).eq('id', id)
      if (error) throw error

      // Sincronizar CxC vinculada al mismo cliente con saldo pendiente
      // Buscar por nombre de cliente (relación legacy por nombre)
      const { data: cxcsPendientes } = await sb.from('disabi_cxc')
        .select('id, saldo, estado')
        .ilike('cliente', pp.cliente)
        .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
        .order('fecha_emision', { ascending: true })

      // Abonar el monto del PP a la primera CxC pendiente del cliente
      // que coincida en monto (o a la más antigua si no hay match exacto)
      const montoPP = pp.total ?? 0
      const cxcExacta = cxcsPendientes?.find(c => Math.abs(c.saldo - montoPP) < 0.02)
      const cxcTarget = cxcExacta ?? cxcsPendientes?.[0]

      if (cxcTarget && montoPP > 0) {
        const nuevoSaldo  = Math.max(0, parseFloat((cxcTarget.saldo - montoPP).toFixed(2)))
        const nuevoEstado = nuevoSaldo <= 0 ? 'Pagado' : 'Parcial'
        await sb.from('disabi_cxc')
          .update({ saldo: nuevoSaldo, estado: nuevoEstado })
          .eq('id', cxcTarget.id)
        await sb.from('disabi_cxc_abonos').insert([{
          cxc_id: cxcTarget.id,
          monto:  montoPP,
          fecha:  fp,
          notas:  `Cobro PP — ${id}`,
        }])
      }

      // Actualizar la venta original a 'Cobrado' si el PP está vinculado por notas_internas
      // notas_internas = 'venta_id:XXXX' se guarda al crear el PP automáticamente
      if (pp.notas_internas?.startsWith('venta_id:')) {
        const ventaOriginalId = pp.notas_internas.replace('venta_id:', '').trim()
        if (ventaOriginalId) {
          await sb.from('disabi_ventas')
            .update({ cobro: 'Cobrado' })
            .eq('id', ventaOriginalId)
            .eq('cobro', 'Pendiente') // solo si aún está pendiente
        }
      }

      return NextResponse.json({ ok: true, cxc_actualizada: !!cxcTarget })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    console.error('[api/ventas]', msg)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

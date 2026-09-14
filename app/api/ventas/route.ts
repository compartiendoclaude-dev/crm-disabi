import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { calcLiquidacion, calcFechaVence, calcFechaPagoPaquetera, inferirEstadoCobro, today } from '@/lib/utils'
import type { Liquidacion } from '@/lib/utils'
import { PAQUETERAS } from '@/lib/constants'
import type { MetodoPago } from '@/lib/types'
import { bloqueadoPorCierre } from '@/lib/cierre-server'
import { requirePermisoEscritura } from '@/lib/permisos-server'
import { crearAsientoContable, borrarAsientoDeOrigen, partirIva, CUENTA, type LineaAsiento } from '@/lib/contabilidad-server'

// ── Contabilidad (Fase 2): líneas del lado Debe de una venta, según cómo se
// cobra. El lado Haber (Ventas + IVA Débito Fiscal) es igual siempre y se
// arma en el llamador — ver save_venta. Reutilizable entre crear y editar.
function lineasDebeVenta(p: {
  cobro: string; metodoPago: string; monto: number; montoNeto: number
  paqCosto: number; paqComMonto: number; liq: Liquidacion | null
}): LineaAsiento[] {
  const lineas: LineaAsiento[] = []
  if (p.cobro === 'Cobrado') {
    const cuentaCaja = p.metodoPago === 'Efectivo' ? CUENTA.CAJA : CUENTA.BANCOS
    lineas.push({ cuenta: cuentaCaja, debe: p.montoNeto, descripcion: 'Cobro de venta' })
    if (p.paqCosto)    lineas.push({ cuenta: CUENTA.FLETES_PAQUETERIA,   debe: p.paqCosto,    descripcion: 'Costo de paquetera' })
    if (p.paqComMonto) lineas.push({ cuenta: CUENTA.COMISIONES_PASARELA, debe: p.paqComMonto, descripcion: 'Comisión de paquetera' })
  } else if (p.cobro === 'Pendiente') {
    lineas.push({ cuenta: CUENTA.CXC_CLIENTES, debe: p.monto, descripcion: 'Venta a crédito' })
  } else if (p.cobro === 'Liquidacion_Pendiente' && p.liq) {
    lineas.push({ cuenta: CUENTA.FONDOS_TRANSITO_PASARELA, debe: p.liq.montoLiquido, descripcion: `Pendiente de liquidar — ${p.metodoPago}` })
    if (p.liq.ivaPercibido) lineas.push({ cuenta: CUENTA.IVA_CREDITO_FISCAL, debe: p.liq.ivaPercibido, descripcion: 'IVA percibido por la pasarela (crédito fiscal)' })
    const comisionPasarela = parseFloat((p.liq.comision + p.liq.ivaComision).toFixed(2))
    if (comisionPasarela) lineas.push({ cuenta: CUENTA.COMISIONES_PASARELA, debe: comisionPasarela, descripcion: 'Comisión de la pasarela' })
  }
  return lineas
}

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

  // Hueco cerrado: esta ruta completa (ventas, cotizaciones/PP, oportunidades)
  // solo validaba que hubiera sesión, no el rol — cualquier usuario autenticado
  // podía escribir aunque su permiso sobre 'ventas' fuera 'read' o false (ej.
  // Finanzas, que solo debe consultar Ventas). Todas las acciones de este
  // archivo mutan tablas del módulo Ventas, así que un solo chequeo a la
  // entrada cubre todo el archivo.
  if (!(await requirePermisoEscritura(user.id, 'ventas')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar Ventas' }, { status: 403 })

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

      // Cierre mensual: no se puede crear ni mover una venta hacia/dentro de un mes cerrado
      const bloqueoNueva = await bloqueadoPorCierre(fecha)
      if (bloqueoNueva) return NextResponse.json({ error: bloqueoNueva }, { status: 409 })
      let numeroVentaExistente: string | undefined
      if (editId) {
        const { data: ventaExistente } = await sb.from('disabi_ventas').select('fecha, numero').eq('id', editId).single()
        numeroVentaExistente = ventaExistente?.numero ?? undefined
        const bloqueoExistente = await bloqueadoPorCierre(ventaExistente?.fecha ?? '')
        if (bloqueoExistente) return NextResponse.json({ error: bloqueoExistente }, { status: 409 })
      }

      const monto = items.reduce((a: number, i: { subtotal: number }) => a + i.subtotal, 0)
      const cobro = inferirEstadoCobro(metodoPago as MetodoPago, esBorrador)

      // ── Límite de crédito — validación del lado del servidor ────────────────
      // Antes esto SOLO se validaba en el navegador (VentasModule.tsx) y solo
      // contra el monto de ESTA venta — cualquiera que llamara la API directo
      // se lo saltaba, y aun respetándolo, un cliente podía acumular deuda
      // ilimitada en varias ventas que individualmente "cupieran" en el
      // límite. Aquí se valida siempre, del lado del servidor, sumando lo que
      // el cliente YA tiene pendiente en disabi_cxc (sin contar la CxC de esta
      // misma venta si se está editando) más el monto de esta venta.
      if (cobro === 'Pendiente') {
        const { data: clienteRow } = await sb.from('disabi_clientes')
          .select('limite_credito')
          .ilike('nombre', nombre.trim())
          .maybeSingle()
        const limite = clienteRow?.limite_credito ?? 0
        if (limite > 0) {
          const { data: cxcAbiertas } = await sb.from('disabi_cxc')
            .select('monto_pendiente, venta_id')
            .ilike('cliente', nombre.trim())
            .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
          const saldoActual = (cxcAbiertas ?? [])
            .filter(c => !(editId && c.venta_id === editId))
            .reduce((a, c) => a + (c.monto_pendiente ?? 0), 0)
          if (saldoActual + monto > limite) {
            return NextResponse.json({
              error: `Límite de crédito excedido. Límite: $${limite.toFixed(2)} — Saldo actual pendiente: $${saldoActual.toFixed(2)} — Esta venta: $${monto.toFixed(2)}`,
            }, { status: 400 })
          }
        }
      }

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
        // ── Editar venta: resincronizar la CxC vinculada ──────────────────────
        // Antes, editar una venta a crédito ya registrada (monto, método de
        // pago, etc.) NUNCA tocaba su Cuenta por Cobrar — quedaban desfasadas.
        // Se valida ANTES de escribir la venta, para no dejarla a medias si
        // hay que rechazar el cambio (abonos ya registrados).
        const { data: cxcLigada } = await sb.from('disabi_cxc')
          .select('id, monto_pagado, monto_pendiente')
          .eq('venta_id', editId)
          .maybeSingle()

        if (cobro !== 'Pendiente' && cxcLigada && (cxcLigada.monto_pagado ?? 0) > 0) {
          // Ya no es crédito (cambiaron el método de pago) pero ya se había
          // cobrado algo de esa CxC — no se puede resolver aquí sin perder el
          // rastro del abono.
          return NextResponse.json({
            error: 'Esta venta tiene abonos registrados en su Cuenta por Cobrar — no se puede cambiar de Crédito a otro método de pago desde aquí. Resuélvalo primero en Finanzas → CxC.',
          }, { status: 409 })
        }

        const { error } = await sb.from('disabi_ventas').update(obj).eq('id', editId)
        if (error) throw error
        await sb.from('disabi_venta_items').delete().eq('venta_id', editId)
        ventaId = editId

        if (cobro === 'Pendiente') {
          const fechaVenceNueva = calcFechaVence(fecha, diasCredito ?? 30)
          if (cxcLigada) {
            // Sigue siendo crédito: sincronizar el monto total con lo cobrado
            // hasta ahora — nunca se toca monto_pagado, solo se recalcula el
            // pendiente y el estado a partir del nuevo total.
            const pagado = cxcLigada.monto_pagado ?? 0
            const pendienteNuevo = Math.max(0, parseFloat((monto - pagado).toFixed(2)))
            const estadoNuevo = pendienteNuevo <= 0 ? 'Pagado' : (pagado > 0 ? 'Parcial' : 'Pendiente')
            await sb.from('disabi_cxc').update({
              monto_total: monto,
              monto_pendiente: pendienteNuevo,
              estado: estadoNuevo,
              fecha_venta: fecha,
              fecha_vence: fechaVenceNueva,
            }).eq('id', cxcLigada.id)
          } else {
            // Antes no era crédito (o es una venta de antes de este fix, sin
            // CxC vinculada) y ahora sí: crear la CxC igual que en una venta
            // nueva a crédito.
            await sb.from('disabi_cxc').insert([{
              cliente:         nombre.trim(),
              monto_total:     monto,
              monto_pagado:    0,
              monto_pendiente: monto,
              estado:          'Pendiente',
              fecha_venta:     fecha,
              fecha_vence:     fechaVenceNueva,
              venta_id:        ventaId,
              notas:           `Generado automáticamente al editar la venta ${obj.numero ?? ventaId} a Crédito`,
            }])
          }
        } else if (cxcLigada) {
          // Ya no es crédito (cambiaron el método de pago en la edición) y no
          // tenía abonos (ya se validó arriba, antes de escribir la venta) —
          // se elimina la CxC que quedó huérfana.
          await sb.from('disabi_cxc').delete().eq('id', cxcLigada.id)
        }
      } else {
        const { data, error } = await sb.from('disabi_ventas').insert([obj]).select().single()
        if (error) throw error
        ventaId = data.id
      }

      // Items — se congela el costo_unitario del producto AL MOMENTO DE LA VENTA,
      // para poder calcular margen real por venta/producto más adelante sin depender
      // del costo actual del catálogo (que puede cambiar después).
      const productoIds = Array.from(new Set(items.map((i: { producto_id?: string }) => i.producto_id).filter(Boolean)))
      const { data: productosCosto } = productoIds.length
        ? await sb.from('disabi_productos').select('id, costo_unitario').in('id', productoIds)
        : { data: [] }
      const costoPorProducto = new Map((productosCosto ?? []).map(p => [p.id, p.costo_unitario ?? 0]))

      const itemsToInsert = items.map((i: { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct?: number; subtotal: number }) => ({
        venta_id:        ventaId,
        producto_id:     i.producto_id || null,
        cantidad:        i.cantidad,
        precio_unitario: i.precio_unitario,
        descuento:       i.descuento_pct ?? 0,
        subtotal:        i.subtotal,
        costo_unitario:  i.producto_id ? (costoPorProducto.get(i.producto_id) ?? 0) : 0,
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

      // Si es Crédito → crear Pendiente de Pago (para el flujo/UI de Ventas) Y su
      // Cuenta por Cobrar real en disabi_cxc, vinculada por venta_id — antes solo se
      // creaba el PP y la CxC de Finanzas quedaba desconectada de las ventas a crédito.
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

        // CxC real, vinculada a esta venta — es la que alimenta Finanzas
        await sb.from('disabi_cxc').insert([{
          cliente:         nombre.trim(),
          monto_total:     monto,
          monto_pagado:    0,
          monto_pendiente: monto,
          estado:          'Pendiente',
          fecha_venta:     fecha,
          fecha_vence:     fechaVence,
          venta_id:        ventaId,
          notas:           `Generado automáticamente desde venta a crédito ${numero ?? ventaId}`,
        }])
      }

      // ══════════════════════════════════════════════════════════════════
      // CONTABILIDAD (Fase 2) — asiento de partida doble de la venta.
      // En edición: se borra el asiento anterior de esta venta (si tenía) y se
      // postea de nuevo con los valores actualizados — mismo criterio de
      // "resincronizar, no acumular" que ya se aplicó a CxC/CPP. No postea
      // nada antes del 1 de nov 2026 — ver CORTE_CONTABLE en
      // lib/contabilidad-server.ts.
      //
      // Nota de criterio contable: el IVA que retiene la pasarela de pago
      // (liq.ivaPercibido) se postea aquí como IVA Crédito Fiscal (activo,
      // recuperable contra el IVA Débito Fiscal del mes) — NO como gasto.
      // Esto es distinto de cómo lo trata hoy el widget de Finanzas (lo resta
      // como "costo de canal" al ingreso neto, una simplificación de reporte).
      // El libro contable de aquí en adelante es la fuente correcta.
      // ══════════════════════════════════════════════════════════════════
      const numeroVenta = numero ?? numeroVentaExistente ?? ventaId
      if (editId) await borrarAsientoDeOrigen(sb, 'disabi_ventas', editId)

      if (cobro !== 'Borrador') {
        const { neto, iva } = partirIva(monto)
        const lineas = lineasDebeVenta({ cobro, metodoPago, monto, montoNeto, paqCosto, paqComMonto, liq })

        if (lineas.length) {
          lineas.push({ cuenta: CUENTA.VENTAS, haber: neto, descripcion: `Venta ${numeroVenta}` })
          if (iva) lineas.push({ cuenta: CUENTA.IVA_DEBITO_FISCAL, haber: iva, descripcion: 'IVA débito fiscal' })

          await crearAsientoContable(sb, {
            fecha,
            concepto: `Venta ${numeroVenta} — ${nombre.trim()}`,
            origenTabla: 'disabi_ventas',
            origenId: ventaId,
            lineas,
            creadoPor: user.id,
          })
        }
      }

      return NextResponse.json({ ok: true, id: ventaId, cobro })
    }

    // ── VENTA: eliminar ─────────────────────────────────────────────────────
    if (action === 'delete_venta') {
      const { id } = body

      // Leer la venta para saber si era activa (no Borrador)
      const { data: ventaAEliminar } = await sb.from('disabi_ventas')
        .select('cobro, fecha').eq('id', id).single()

      const bloqueoDel = await bloqueadoPorCierre(ventaAEliminar?.fecha ?? '')
      if (bloqueoDel) return NextResponse.json({ error: bloqueoDel }, { status: 409 })

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

      // Contabilidad (Fase 2): si esta venta ya generó un asiento (fecha >=
      // corte contable), no dejarlo huérfano apuntando a una venta que ya no
      // existe — se borra junto (disabi_partidas se va en cascada por FK).
      // Mismo criterio que ya se aplicó a las CPP huérfanas de compras/gastos.
      await borrarAsientoDeOrigen(sb, 'disabi_ventas', id)

      await sb.from('disabi_venta_items').delete().eq('venta_id', id)
      const { error } = await sb.from('disabi_ventas').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── VENTA: confirmar liquidación ────────────────────────────────────────
    // El banco ya depositó lo que la pasarela retuvo en tránsito — se traslada
    // de Fondos en Tránsito (Pasarela) a Bancos. Se lee la venta ANTES de
    // actualizar su estado, para tener los datos con los que se posteó el
    // asiento original. origenTabla sigue siendo 'disabi_ventas' (mismo que la
    // venta) a propósito: así el cleanup de delete_venta borra ambos asientos
    // juntos si la venta se elimina más adelante.
    if (action === 'confirmar_liquidacion') {
      const { id } = body
      const { data: ventaLiq } = await sb.from('disabi_ventas')
        .select('numero, nombre, fecha, cobro, liq_monto_liquido, monto')
        .eq('id', id).single()

      const { error } = await sb.from('disabi_ventas').update({ cobro: 'Cobrado' }).eq('id', id)
      if (error) throw error

      if (ventaLiq?.cobro === 'Liquidacion_Pendiente' && ventaLiq.liq_monto_liquido) {
        await crearAsientoContable(sb, {
          fecha: today(),
          concepto: `Liquidación venta ${ventaLiq.numero ?? id} — ${ventaLiq.nombre}`,
          origenTabla: 'disabi_ventas',
          origenId: id,
          lineas: [
            { cuenta: CUENTA.BANCOS, debe: ventaLiq.liq_monto_liquido, descripcion: 'Depósito de liquidación de pasarela' },
            { cuenta: CUENTA.FONDOS_TRANSITO_PASARELA, haber: ventaLiq.liq_monto_liquido, descripcion: 'Traspaso desde fondos en tránsito' },
          ],
          creadoPor: user.id,
        })
      }
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
        'metodo_pago','dias_credito','credito_50_50','oportunidad_id']
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

        // Si esta cotización nace de una Oportunidad (botón "Convertir a
        // Cotización"), avanzar su etapa a 'Propuesta' — solo si sigue en una
        // etapa más temprana del embudo, nunca retrocede una que ya avanzó más
        // (Negociación) ni toca una ya cerrada (Ganada/Perdida).
        if (fields.oportunidad_id) {
          const { data: op } = await sb.from('disabi_oportunidades')
            .select('etapa').eq('id', fields.oportunidad_id).maybeSingle()
          if (op && (op.etapa === 'Prospección' || op.etapa === 'Calificación')) {
            await sb.from('disabi_oportunidades')
              .update({ etapa: 'Propuesta', updated_at: new Date().toISOString() })
              .eq('id', fields.oportunidad_id)
          }
        }
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

    // ── OPORTUNIDAD: guardar ────────────────────────────────────────────────
    // Registro previo a la Cotización — embudo comercial (Prospección →
    // Calificación → Propuesta → Negociación → Ganada/Perdida). El permiso de
    // escritura sobre Ventas ya se valida una sola vez al entrar a la ruta.
    if (action === 'save_oportunidad') {
      const { editId, ...fields } = body
      const SAFE_OP = ['cliente','cliente_id','contacto','telefono','email','sector','canal',
        'descripcion','valor_estimado','probabilidad_pct','fecha_estimada_cierre',
        'proxima_accion','fecha_proxima_accion','notas','vendedor_id']
      const obj: Record<string, unknown> = { updated_at: new Date().toISOString() }
      SAFE_OP.forEach(k => { if (fields[k] !== undefined) obj[k] = fields[k] })

      if (editId) {
        const { error } = await sb.from('disabi_oportunidades').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { count } = await sb.from('disabi_oportunidades').select('*', { count: 'exact', head: true })
        obj.numero = 'OP-' + String((count ?? 0) + 1).padStart(4, '0')
        obj.etapa  = 'Prospección'
        const { data, error } = await sb.from('disabi_oportunidades').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── OPORTUNIDAD: cambiar de etapa ───────────────────────────────────────
    // Al llegar a Ganada/Perdida se congela fecha_cierre_real (para poder medir
    // después tiempos de ciclo y tasa de conversión). Al mover de vuelta a una
    // etapa abierta (si alguien se equivocó) esa fecha se limpia.
    if (action === 'cambiar_etapa_oportunidad') {
      const { id, etapa, motivo_perdida } = body
      const ETAPAS = ['Prospección','Calificación','Propuesta','Negociación','Ganada','Perdida']
      if (!ETAPAS.includes(etapa)) return NextResponse.json({ error: 'Etapa inválida' }, { status: 400 })
      if (etapa === 'Perdida' && !motivo_perdida?.trim())
        return NextResponse.json({ error: 'Indica el motivo de la pérdida' }, { status: 400 })

      const cerrando = etapa === 'Ganada' || etapa === 'Perdida'
      const obj: Record<string, unknown> = {
        etapa,
        updated_at: new Date().toISOString(),
        fecha_cierre_real: cerrando ? today() : null,
        motivo_perdida: etapa === 'Perdida' ? motivo_perdida.trim() : null,
      }
      const { error } = await sb.from('disabi_oportunidades').update(obj).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── OPORTUNIDAD: eliminar ───────────────────────────────────────────────
    if (action === 'delete_oportunidad') {
      const { id } = body
      // Si ya tiene una Cotización vinculada, desvincular en vez de dejar el FK roto.
      await sb.from('disabi_cotizaciones').update({ oportunidad_id: null }).eq('oportunidad_id', id)
      const { error } = await sb.from('disabi_oportunidades').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── PP: marcar pagado ───────────────────────────────────────────────────
    // Corregido: antes intentaba sincronizar disabi_cxc usando columnas que ya no
    // existen (saldo, monto) — fallaba en silencio. Ahora usa monto_pendiente /
    // monto_pagado (columnas reales) y busca la CxC exacta por venta_id en vez de
    // adivinar por nombre de cliente + monto.
    if (action === 'pagar_pp') {
      const { id, fecha_pago } = body
      const fp = fecha_pago || new Date().toISOString().slice(0, 10)

      const bloqueoPago = await bloqueadoPorCierre(fp)
      if (bloqueoPago) return NextResponse.json({ error: bloqueoPago }, { status: 409 })

      // Leer el PP para obtener cliente, monto y la venta que lo originó
      const { data: pp } = await sb.from('disabi_cotizaciones')
        .select('cliente, total, notas_internas').eq('id', id).single()
      if (!pp) return NextResponse.json({ error: 'PP no encontrado' }, { status: 404 })

      // Marcar el PP como pagado
      const { error } = await sb.from('disabi_cotizaciones')
        .update({ estado: 'Pagado' }).eq('id', id)
      if (error) throw error

      const ventaOriginalId = pp.notas_internas?.startsWith('venta_id:')
        ? pp.notas_internas.replace('venta_id:', '').trim()
        : null

      // Buscar la CxC vinculada a esta venta exactamente (venta_id) — solo si no
      // existe (registros de antes de este fix) se cae al match legacy por cliente.
      let cxcTarget: { id: string; monto_pendiente: number; monto_pagado: number } | null = null
      if (ventaOriginalId) {
        const { data } = await sb.from('disabi_cxc')
          .select('id, monto_pendiente, monto_pagado')
          .eq('venta_id', ventaOriginalId)
          .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
          .maybeSingle()
        cxcTarget = data
      }
      if (!cxcTarget) {
        const montoPP = pp.total ?? 0
        const { data: cxcsPendientes } = await sb.from('disabi_cxc')
          .select('id, monto_pendiente, monto_pagado')
          .ilike('cliente', pp.cliente)
          .is('venta_id', null)
          .in('estado', ['Pendiente', 'Parcial', 'Vencido'])
          .order('fecha_venta', { ascending: true })
        const cxcExacta = cxcsPendientes?.find(c => Math.abs(c.monto_pendiente - montoPP) < 0.02)
        cxcTarget = cxcExacta ?? cxcsPendientes?.[0] ?? null
      }

      const montoPP = pp.total ?? 0
      if (cxcTarget && montoPP > 0) {
        const nuevoPendiente = Math.max(0, parseFloat(((cxcTarget.monto_pendiente ?? 0) - montoPP).toFixed(2)))
        const nuevoPagado    = parseFloat(((cxcTarget.monto_pagado ?? 0) + montoPP).toFixed(2))
        const nuevoEstado    = nuevoPendiente <= 0 ? 'Pagado' : 'Parcial'
        await sb.from('disabi_cxc')
          .update({ monto_pendiente: nuevoPendiente, monto_pagado: nuevoPagado, estado: nuevoEstado,
                     fecha_pago: nuevoEstado === 'Pagado' ? fp : null })
          .eq('id', cxcTarget.id)
        await sb.from('disabi_cxc_abonos').insert([{
          cxc_id: cxcTarget.id,
          monto:  montoPP,
          fecha:  fp,
          notas:  `Cobro PP — ${id}`,
        }])
      }

      // Actualizar la venta original a 'Cobrado'
      if (ventaOriginalId) {
        await sb.from('disabi_ventas')
          .update({ cobro: 'Cobrado' })
          .eq('id', ventaOriginalId)
          .eq('cobro', 'Pendiente') // solo si aún está pendiente
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

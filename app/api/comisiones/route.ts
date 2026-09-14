import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { segundoLunesHabil, calcISRComision } from '@/lib/utils'
import { PLANILLA } from '@/lib/constants'
import { requirePermisoEscritura } from '@/lib/permisos-server'
import { bloqueadoPorCierre } from '@/lib/cierre-server'
import { crearAsientoContable, borrarAsientoDeOrigen, finDeMes, CUENTA } from '@/lib/contabilidad-server'
import { calcularLineasComision } from '@/lib/comisiones-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

// Calcular ISR según tipo_calculo del empleado
function calcRetencion(tipo: 'empleado' | 'honorarios', comisionBruta: number): number {
  if (tipo === 'honorarios') {
    return parseFloat((comisionBruta * PLANILLA.RETENCION_HONORARIOS).toFixed(2))
  }
  return calcISRComision(comisionBruta)
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  // Comisiones vive dentro del módulo Planilla en la UI (mismo PERMISOS.planilla)
  if (!(await requirePermisoEscritura(user.id, 'planilla')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar Comisiones' }, { status: 403 })

  const body = await req.json()
  const { action } = body

  try {
    // ── CALCULAR comisión de un empleado para un período ────────────────────
    if (action === 'calcular_comision') {
      const { empleado_id, periodo } = body
      if (!empleado_id || !periodo)
        return NextResponse.json({ error: 'Empleado y período requeridos' }, { status: 400 })

      // Leer datos del empleado
      const { data: emp } = await sb.from('disabi_empleados')
        .select('nombre, tipo_contrato, activo').eq('id', empleado_id).single()
      if (!emp) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

      const tipoCal: 'empleado' | 'honorarios' =
        (emp as { tipo_contrato?: string }).tipo_contrato === 'empleado' ? 'empleado' : 'honorarios'

      // Rango de fechas del período
      const [anio, mes] = periodo.split('-').map(Number)
      const ini = `${periodo}-01`
      const fin = `${periodo}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`

      // Cálculo de líneas por categoría/tramo — lógica compartida con la
      // comparación contra el Excel maestro (ver lib/comisiones-server.ts).
      const { lineas, comisionBruta, modoLegacy } = await calcularLineasComision(sb, periodo, empleado_id)

      // Verificar crédito pendiente: solo de clientes atendidos por ESTE vendedor.
      // Requiere su propia lectura de ventas (con nombre de cliente) — la del
      // cálculo de comisión no lo trae. Si el vendedor no tiene ventas asignadas
      // (modo legacy), revisa todas las CxC (comportamiento conservador).
      const { data: ventaItemsCredito } = await sb
        .from('disabi_venta_items')
        .select('venta:disabi_ventas!inner(fecha, cobro, nombre, vendedor_id, devolucion_estado)')
        .gte('venta.fecha', ini).lte('venta.fecha', fin)
        .in('venta.cobro', ['Cobrado', 'Pendiente', 'Liquidacion_Pendiente'])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ventasDelVendedor = (ventaItemsCredito ?? []).filter((vi: any) => {
        const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
        return venta?.devolucion_estado !== 'Devuelta' && venta?.vendedor_id === empleado_id
      })

      let tieneCreditoPendiente = false
      if (!modoLegacy && ventasDelVendedor.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientesDelVendedor = Array.from(new Set((ventasDelVendedor as any[]).map(vi => {
          const venta = Array.isArray(vi.venta) ? vi.venta[0] : vi.venta
          return (venta?.nombre ?? '').toLowerCase().trim()
        }).filter(Boolean)))

        if (clientesDelVendedor.length > 0) {
          const { data: cxcVendedor } = await sb.from('disabi_cxc')
            .select('id, cliente')
            .in('estado', ['Pendiente', 'Vencido', 'Parcial'])
          tieneCreditoPendiente = (cxcVendedor ?? []).some(cxc =>
            clientesDelVendedor.includes((cxc.cliente ?? '').toLowerCase().trim())
          )
        }
      } else {
        // Modo legacy: sin vendedor asignado → revisar todas (comportamiento conservador)
        const { data: cxcPendientes } = await sb.from('disabi_cxc')
          .select('id').in('estado', ['Pendiente', 'Vencido', 'Parcial']).limit(1)
        tieneCreditoPendiente = (cxcPendientes?.length ?? 0) > 0
      }

      const retencionISR    = calcRetencion(tipoCal, comisionBruta)
      const comisionNeta    = parseFloat((comisionBruta - retencionISR).toFixed(2))
      const fechaPagoProg   = segundoLunesHabil(anio, mes + 1) // se paga el mes siguiente

      return NextResponse.json({
        ok: true,
        preview: {
          empleado_nombre: (emp as { nombre: string }).nombre,
          tipo_calculo: tipoCal,
          periodo,
          fecha_pago_prog: fechaPagoProg,
          comision_bruta: comisionBruta,
          retencion_isr: retencionISR,
          comision_neta: comisionNeta,
          pct_retencion: tipoCal === 'honorarios' ? '10%' : 'Tabla ISR',
          bloqueado: tieneCreditoPendiente,
          modo_legacy: modoLegacy,
          lineas,
        },
      })
    }

    // ── GUARDAR registro de comisión ────────────────────────────────────────
    if (action === 'save_comision') {
      const { empleado_id, periodo, comision_bruta, retencion_isr, comision_neta,
              tipo_calculo, fecha_pago_prog, estado, notas, lineas } = body

      const bloqueoComision = await bloqueadoPorCierre(periodo)
      if (bloqueoComision) return NextResponse.json({ error: bloqueoComision }, { status: 409 })

      // Upsert del registro cabecera
      const { data: reg, error: regErr } = await sb.from('disabi_comision_registros')
        .upsert({
          empleado_id, periodo,
          comision_bruta, retencion_isr, comision_neta,
          tipo_calculo, fecha_pago_prog: fecha_pago_prog || null,
          estado: estado || (body.bloqueado ? 'Bloqueado' : 'Pendiente'),
          notas: notas || null,
        }, { onConflict: 'empleado_id,periodo' })
        .select().single()
      if (regErr) throw regErr

      // Eliminar líneas anteriores e insertar nuevas
      await sb.from('disabi_comision_lineas').delete().eq('comision_registro_id', reg.id)
      if (lineas?.length) {
        const lineasInsert = lineas.map((l: {
          rango_id?: string; categoria: string; precio_iva_desc: string
          precio_sin_iva: number; pct_comision: number; cantidad_vendida: number; comision_linea: number
        }) => ({ ...l, comision_registro_id: reg.id }))
        const { error: lErr } = await sb.from('disabi_comision_lineas').insert(lineasInsert)
        if (lErr) throw lErr
      }

      // ══════════════════════════════════════════════════════════════════
      // CONTABILIDAD (Fase 2) — devengo de comisión. Se acumula al cierre del
      // mes del período, igual que Planilla. No se separa la retención ISR
      // aquí: el flujo real modelado (pagar_comision) paga comision_bruta
      // completa, sin remesa de retención por separado — el asiento sigue
      // fielmente ese flujo. Resincroniza en cada guardado (el upsert de
      // arriba puede ser edición de un período ya generado).
      // ══════════════════════════════════════════════════════════════════
      if (comision_bruta > 0) {
        const { data: empComision } = await sb.from('disabi_empleados').select('nombre').eq('id', empleado_id).single()
        await borrarAsientoDeOrigen(sb, 'disabi_comision_registros', reg.id)
        await crearAsientoContable(sb, {
          fecha: finDeMes(periodo),
          concepto: `Comisión ${periodo} — ${empComision?.nombre ?? empleado_id}`,
          origenTabla: 'disabi_comision_registros',
          origenId: reg.id,
          lineas: [
            { cuenta: CUENTA.COMISIONES_SOBRE_VENTAS, debe: comision_bruta, descripcion: 'Comisión devengada' },
            { cuenta: CUENTA.COMISIONES_POR_PAGAR, haber: comision_bruta, descripcion: 'Comisión por pagar' },
          ],
          creadoPor: user.id,
        })
      }

      return NextResponse.json({ ok: true, id: reg.id })
    }

    // ── PAGAR comisión ──────────────────────────────────────────────────────
    if (action === 'pagar_comision') {
      const { id, fecha_pago_real } = body
      const fp = fecha_pago_real || new Date().toISOString().slice(0, 10)

      const bloqueoPagoCom = await bloqueadoPorCierre(fp)
      if (bloqueoPagoCom) return NextResponse.json({ error: bloqueoPagoCom }, { status: 409 })

      // Leer registro para trazabilidad
      const { data: reg } = await sb.from('disabi_comision_registros')
        .select('*, empleado:disabi_empleados(nombre, tipo_contrato)')
        .eq('id', id).single()
      if (!reg) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

      const { error } = await sb.from('disabi_comision_registros')
        .update({ estado: 'Pagado', fecha_pago_real: fp })
        .eq('id', id)
      if (error) throw error

      // Puente financiero: registrar egreso real en disabi_gastos
      const empNombre = (reg.empleado as { nombre?: string } | null)?.nombre ?? 'Vendedor'
      const { data: gastoComision } = await sb.from('disabi_gastos').insert([{
        fecha:       fp,
        categoria:   'Comisiones',
        descripcion: `Pago comisión ${reg.periodo} — ${empNombre} [id:${id}]`,
        monto:       reg.comision_bruta,
        factura:     'Sí',
        proveedor:   empNombre,
        tipo_egreso: 'comision_venta',
      }]).select().single()

      // Contabilidad (Fase 2): sale de Bancos la comisión bruta completa (sin
      // separar retención ISR — no se modela una remesa aparte, ver nota en
      // save_comision). origenTabla es el gasto puente, no el registro de
      // comisión, para no pisarse con el asiento de devengo al resincronizar.
      if (gastoComision && reg.comision_bruta > 0) {
        await crearAsientoContable(sb, {
          fecha: fp,
          concepto: `Pago comisión ${reg.periodo} — ${empNombre}`,
          origenTabla: 'disabi_gastos',
          origenId: gastoComision.id,
          lineas: [
            { cuenta: CUENTA.COMISIONES_POR_PAGAR, debe: reg.comision_bruta, descripcion: 'Pago de comisión' },
            { cuenta: CUENTA.BANCOS, haber: reg.comision_bruta, descripcion: 'Pago desde bancos' },
          ],
          creadoPor: user.id,
        })
      }

      return NextResponse.json({ ok: true })
    }

    // ── ELIMINAR registro ───────────────────────────────────────────────────
    if (action === 'delete_comision') {
      const { id } = body
      // Contabilidad (Fase 2): no dejar huérfano el asiento de devengo de esta comisión.
      await borrarAsientoDeOrigen(sb, 'disabi_comision_registros', id)
      await sb.from('disabi_comision_lineas').delete().eq('comision_registro_id', id)
      const { error } = await sb.from('disabi_comision_registros').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── OBTENER rangos ──────────────────────────────────────────────────────
    if (action === 'get_rangos') {
      const { data } = await sb.from('disabi_comision_rangos')
        .select('*').eq('activo', true).order('categoria').order('orden')
      return NextResponse.json({ ok: true, rangos: data ?? [] })
    }

    // ── GUARDAR rango (editar tabla maestra) ────────────────────────────────
    if (action === 'save_rango') {
      const { editId, categoria, precio_iva_desc, precio_min_iva, precio_max_iva, precio_sin_iva, pct_comision, orden, usar_precio_real } = body
      const obj = { categoria, precio_iva_desc, precio_min_iva: precio_min_iva || null, precio_max_iva: precio_max_iva || null, precio_sin_iva, pct_comision, orden: orden || 1, usar_precio_real: !!usar_precio_real }
      if (editId) {
        const { error } = await sb.from('disabi_comision_rangos').update(obj).eq('id', editId)
        if (error) throw error
      } else {
        const { error } = await sb.from('disabi_comision_rangos').insert([obj])
        if (error) throw error
      }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/comisiones]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

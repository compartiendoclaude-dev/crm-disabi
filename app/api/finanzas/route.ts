import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { today } from '@/lib/utils'
import { requirePermisoEscritura, requirePermisoLectura, tienePermisoExtra } from '@/lib/permisos-server'
import { bloqueadoPorCierre } from '@/lib/cierre-server'
import {
  crearAsientoContable, borrarAsientoDeOrigen, borrarAsientosPorOrigenes, finDeMes,
  CUENTA, CUENTA_POR_TIPO_EGRESO, CATEGORIA_CPP_CUENTA, CATEGORIA_COSTO_FIJO_CUENTA,
} from '@/lib/contabilidad-server'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  const tieneFinanzas = await requirePermisoEscritura(user.id, 'finanzas')
  if (!tieneFinanzas) {
    // Única excepción al módulo completo: Ventas (Comercial) puede REGISTRAR
    // (nunca editar ni eliminar) gastos operativos variables — permiso
    // angosto, no el acceso completo a Finanzas.
    const puedeGastoVariable = action === 'save_gasto' && !body.editId &&
      (await tienePermisoExtra(user.id, 'gastos_variables'))
    if (!puedeGastoVariable)
      return NextResponse.json({ error: 'Tu rol no tiene permiso para modificar Finanzas' }, { status: 403 })
  }

  try {
    // ── CXC: registrar abono ────────────────────────────────────────────────
    // ── CxC: crear manual ─────────────────────────────────────────────────────
    // Columnas reales de disabi_cxc: monto_total, monto_pagado, monto_pendiente,
    // fecha_venta (no fecha_emision), fecha_vence, fecha_pago, fecha_cobro — sin 'numero'.
    if (action === 'save_cxc') {
      const { editId, cliente, monto, fecha_emision, fecha_vence, notas, estado: estadoParam } = body
      if (!cliente?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Cliente y monto son requeridos' }, { status: 400 })

      const bloqueoCxc = await bloqueadoPorCierre(fecha_emision || today())
      if (bloqueoCxc) return NextResponse.json({ error: bloqueoCxc }, { status: 409 })

      const montoNum = parseFloat(monto)
      const yaPagada = estadoParam === 'Pagado'

      if (editId) {
        // Corregido: antes esta rama recalculaba monto_pagado/monto_pendiente/estado
        // solo desde el checkbox "¿ya pagada?" del formulario, ignorando por completo
        // los abonos ya registrados en disabi_cxc_abonos — editar una CxC con abonos
        // parciales (aunque fuera solo para corregir una nota) borraba el abono en
        // silencio, regresando el saldo pendiente al monto total completo.
        // Ahora el saldo se deriva SIEMPRE de la suma real de abonos — la única
        // fuente de verdad — nunca del checkbox del formulario al editar.
        const { data: abonosExistentes } = await sb.from('disabi_cxc_abonos')
          .select('monto').eq('cxc_id', editId)
        const totalAbonado    = (abonosExistentes ?? []).reduce((a, x) => a + (x.monto ?? 0), 0)
        const nuevoPendiente  = Math.max(0, parseFloat((montoNum - totalAbonado).toFixed(2)))
        const nuevoEstado     = nuevoPendiente <= 0 ? 'Pagado' : totalAbonado > 0 ? 'Parcial' : 'Pendiente'

        const objEdit = {
          cliente: cliente.trim(),
          monto_total: montoNum,
          monto_pagado: parseFloat(totalAbonado.toFixed(2)),
          monto_pendiente: nuevoPendiente,
          estado: nuevoEstado,
          fecha_venta: fecha_emision || today(),
          fecha_vence: fecha_vence || null,
          fecha_pago: nuevoEstado === 'Pagado' ? (fecha_vence || fecha_emision || today()) : null,
          notas: notas || null,
        }
        const { error } = await sb.from('disabi_cxc').update(objEdit).eq('id', editId)
        if (error) throw error

        // Contabilidad (Fase 2b) — resincroniza el asiento de creación (Debe
        // CxC / Haber Otros Ingresos) con el monto_total actualizado. Nota: si
        // esta CxC se cargó originalmente "ya cobrada" (el asiento se posteó
        // contra Bancos vía disabi_cxc_abonos, no aquí), editar el monto NO
        // toca ese asiento histórico — caso raro, se resuelve manualmente
        // desde el libro contable si llega a pasar.
        await borrarAsientoDeOrigen(sb, 'disabi_cxc', editId)
        await crearAsientoContable(sb, {
          fecha: fecha_emision || today(),
          concepto: `CxC manual — ${cliente.trim()}`,
          origenTabla: 'disabi_cxc',
          origenId: editId,
          lineas: [
            { cuenta: CUENTA.CXC_CLIENTES, debe: montoNum, descripcion: `CxC — ${cliente.trim()}` },
            { cuenta: CUENTA.OTROS_INGRESOS, haber: montoNum, descripcion: 'Ingreso registrado manualmente' },
          ],
          creadoPor: user.id,
        })

        return NextResponse.json({ ok: true, id: editId })
      }

      // Creación — aquí sí se respeta el checkbox "¿ya pagada?" del formulario,
      // para poder cargar un registro histórico que ya estaba cobrado.
      const obj = {
        cliente: cliente.trim(),
        monto_total: montoNum,
        monto_pagado: yaPagada ? montoNum : 0,
        monto_pendiente: yaPagada ? 0 : montoNum,
        estado: yaPagada ? 'Pagado' : 'Pendiente',
        fecha_venta: fecha_emision || today(),
        fecha_vence: fecha_vence || null,
        fecha_pago: yaPagada ? (fecha_vence || fecha_emision || today()) : null,
        notas: notas || null,
      }
      const { data, error } = await sb.from('disabi_cxc').insert([obj]).select().single()
      if (error) throw error

      // Contabilidad (Fase 2b): una CxC manual no viene de una venta del
      // módulo Ventas — se postea contra 4104 Otros Ingresos (no 4101 Ventas,
      // para no inflar la cifra de ventas de producto). Si ya se cargó como
      // cobrada, no tiene sentido pasar por la CxC — se registra el cobro
      // directo a Bancos, igual que un abono instantáneo.
      if (yaPagada) {
        const { data: abono } = await sb.from('disabi_cxc_abonos').insert([{
          cxc_id: data.id, monto: montoNum, fecha: fecha_vence || fecha_emision || today(),
          notas: 'Registro histórico — ya cobrada al momento de la carga',
        }]).select().single()

        if (abono) {
          await crearAsientoContable(sb, {
            fecha: fecha_vence || fecha_emision || today(),
            concepto: `CxC manual (ya cobrada) — ${cliente.trim()}`,
            origenTabla: 'disabi_cxc_abonos',
            origenId: abono.id,
            lineas: [
              { cuenta: CUENTA.BANCOS, debe: montoNum, descripcion: 'Cobro registrado manualmente' },
              { cuenta: CUENTA.OTROS_INGRESOS, haber: montoNum, descripcion: 'Ingreso registrado manualmente' },
            ],
            creadoPor: user.id,
          })
        }
      } else {
        await crearAsientoContable(sb, {
          fecha: fecha_emision || today(),
          concepto: `CxC manual — ${cliente.trim()}`,
          origenTabla: 'disabi_cxc',
          origenId: data.id,
          lineas: [
            { cuenta: CUENTA.CXC_CLIENTES, debe: montoNum, descripcion: `CxC — ${cliente.trim()}` },
            { cuenta: CUENTA.OTROS_INGRESOS, haber: montoNum, descripcion: 'Ingreso registrado manualmente' },
          ],
          creadoPor: user.id,
        })
      }
      return NextResponse.json({ ok: true, id: data.id })
    }

    // ── CxC: eliminar ────────────────────────────────────────────────────────
    if (action === 'delete_cxc') {
      const { id } = body
      const { data: cxcExist } = await sb.from('disabi_cxc').select('fecha_venta').eq('id', id).single()
      const bloqueoDelCxc = await bloqueadoPorCierre(cxcExist?.fecha_venta ?? '')
      if (bloqueoDelCxc) return NextResponse.json({ error: bloqueoDelCxc }, { status: 409 })

      // Contabilidad (Fase 2): no dejar huérfanos ni el asiento de creación de
      // esta CxC ni los de sus abonos — se borran junto, antes de borrar las
      // filas mismas.
      await borrarAsientoDeOrigen(sb, 'disabi_cxc', id)
      const { data: abonosDelCxc } = await sb.from('disabi_cxc_abonos').select('id').eq('cxc_id', id)
      if (abonosDelCxc?.length) {
        await borrarAsientosPorOrigenes(sb, 'disabi_cxc_abonos', abonosDelCxc.map(a => a.id))
      }

      await sb.from('disabi_cxc_abonos').delete().eq('cxc_id', id)
      const { error } = await sb.from('disabi_cxc').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (action === 'save_cxc_abono') {
      const { cxc_id, monto, fecha, notas } = body
      if (!cxc_id || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const bloqueoAbono = await bloqueadoPorCierre(fecha || today())
      if (bloqueoAbono) return NextResponse.json({ error: bloqueoAbono }, { status: 409 })

      const { data: cxc } = await sb.from('disabi_cxc')
        .select('cliente, monto_pendiente, monto_pagado, estado').eq('id', cxc_id).single()
      if (!cxc) return NextResponse.json({ error: 'CXC no encontrada' }, { status: 404 })

      const abonoMonto     = parseFloat(monto)
      const nuevoPendiente = Math.max(0, parseFloat(((cxc.monto_pendiente ?? 0) - abonoMonto).toFixed(2)))
      const nuevoPagado    = parseFloat(((cxc.monto_pagado ?? 0) + abonoMonto).toFixed(2))
      const nuevoEstado    = nuevoPendiente <= 0 ? 'Pagado' : 'Parcial'

      const { data: abono, error: aErr } = await sb.from('disabi_cxc_abonos').insert([{
        cxc_id, monto: abonoMonto, fecha: fecha || today(), notas: notas || null,
      }]).select().single()
      if (aErr) throw aErr

      const { error: uErr } = await sb.from('disabi_cxc').update({
        monto_pendiente: nuevoPendiente, monto_pagado: nuevoPagado, estado: nuevoEstado,
        fecha_pago: nuevoEstado === 'Pagado' ? (fecha || today()) : null,
      }).eq('id', cxc_id)
      if (uErr) throw uErr

      // Contabilidad (Fase 2): el cliente pagó — el efectivo/transferencia
      // entra a Bancos y se reduce su Cuenta por Cobrar. origenTabla es el
      // propio abono (no la CxC) porque un abono es un evento puntual — varios
      // abonos de la misma CxC no deben pisarse el asiento entre sí.
      await crearAsientoContable(sb, {
        fecha: fecha || today(),
        concepto: `Abono de ${cxc.cliente} — CxC`,
        origenTabla: 'disabi_cxc_abonos',
        origenId: abono.id,
        lineas: [
          { cuenta: CUENTA.BANCOS,       debe:  abonoMonto, descripcion: 'Cobro de abono' },
          { cuenta: CUENTA.CXC_CLIENTES, haber: abonoMonto, descripcion: `Abono de ${cxc.cliente}` },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({ ok: true, nuevoPendiente, nuevoEstado })
    }

    // ── CPP: registrar pago ─────────────────────────────────────────────────
    // ── CPP: crear manual ─────────────────────────────────────────────────────
    if (action === 'save_cpp') {
      const { editId, proveedor, monto, fecha_emision, fecha_vence, notas, referencia, estado: estadoParam, categoria_gasto } = body
      if (!proveedor?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Proveedor y monto son requeridos' }, { status: 400 })

      const bloqueoCpp = await bloqueadoPorCierre(fecha_emision || today())
      if (bloqueoCpp) return NextResponse.json({ error: bloqueoCpp }, { status: 409 })

      const montoNum = parseFloat(monto)
      const yaPagada = estadoParam === 'Pagado'
      // Categoría elegida en el formulario → cuenta contable (ver
      // CATEGORIA_CPP_CUENTA) — 'otro' si no se manda nada (registros viejos
      // sin esta columna también caen aquí).
      const catGasto = categoria_gasto || 'otro'
      const cuentaGastoCpp = CATEGORIA_CPP_CUENTA[catGasto] ?? CUENTA.OTROS_GASTOS_OPERATIVOS

      if (editId) {
        // Mismo bug y misma corrección que en save_cxc arriba: el saldo se deriva
        // SIEMPRE de la suma real de pagos en disabi_cpp_pagos — nunca del checkbox
        // "¿ya pagada?" del formulario al editar — para no borrar pagos ya hechos.
        // De paso: tampoco se toca `origen` al editar — antes se sobrescribía
        // siempre a 'manual', lo que habría desclasificado silenciosamente una CPP
        // generada automáticamente desde una importación (origen='compra_importacion').
        const { data: pagosExistentes } = await sb.from('disabi_cpp_pagos')
          .select('monto').eq('cpp_id', editId)
        const totalPagado    = (pagosExistentes ?? []).reduce((a, x) => a + (x.monto ?? 0), 0)
        const nuevoPendiente = Math.max(0, parseFloat((montoNum - totalPagado).toFixed(2)))
        const nuevoEstado    = nuevoPendiente <= 0 ? 'Pagado' : totalPagado > 0 ? 'Parcial' : 'Pendiente'

        const objEdit = {
          proveedor: proveedor.trim(),
          monto_total: montoNum,
          monto_pagado: parseFloat(totalPagado.toFixed(2)),
          monto_pendiente: nuevoPendiente,
          estado: nuevoEstado,
          fecha_emision: fecha_emision || today(),
          fecha_vence: fecha_vence || null,
          fecha_pago: nuevoEstado === 'Pagado' ? (fecha_vence || fecha_emision || today()) : null,
          notas: notas || null,
          descripcion: referencia || null,
          categoria_gasto: catGasto,
        }
        const { error } = await sb.from('disabi_cpp').update(objEdit).eq('id', editId)
        if (error) throw error

        // Contabilidad (Fase 2b) — resincroniza el asiento de creación (Debe
        // [cuenta de gasto] / Haber CxP) con el monto y la categoría actuales.
        // Mismo caveat que en save_cxc: si esta CPP se cargó "ya pagada", el
        // asiento vive en disabi_cpp_pagos, no aquí — editar el monto no lo toca.
        await borrarAsientoDeOrigen(sb, 'disabi_cpp', editId)
        await crearAsientoContable(sb, {
          fecha: fecha_emision || today(),
          concepto: `CPP manual — ${proveedor.trim()}`,
          origenTabla: 'disabi_cpp',
          origenId: editId,
          lineas: [
            { cuenta: cuentaGastoCpp, debe: montoNum, descripcion: referencia || `Gasto — ${proveedor.trim()}` },
            { cuenta: CUENTA.CXP_PROVEEDORES, haber: montoNum, descripcion: `CxP a ${proveedor.trim()}` },
          ],
          creadoPor: user.id,
        })

        return NextResponse.json({ ok: true, id: editId })
      }

      // Creación manual — aquí sí se respeta el checkbox "¿ya pagada?" del
      // formulario, para poder cargar un registro histórico ya pagado.
      const { count } = await sb.from('disabi_cpp').select('*', { count: 'exact', head: true })
      const numero = 'CPP-' + String((count ?? 0) + 1).padStart(4, '0')
      const obj = {
        proveedor: proveedor.trim(),
        monto_total: montoNum,
        monto_pendiente: yaPagada ? 0 : montoNum,
        monto_pagado: yaPagada ? montoNum : 0,
        estado: yaPagada ? 'Pagado' : 'Pendiente',
        fecha_emision: fecha_emision || today(),
        fecha_vence: fecha_vence || null,
        fecha_pago: yaPagada ? (fecha_vence || fecha_emision || today()) : null,
        notas: notas || null,
        descripcion: referencia || null,
        origen: 'manual',
        categoria_gasto: catGasto,
      }
      const { data, error } = await sb.from('disabi_cpp').insert([{ ...obj, numero_doc: numero }]).select().single()
      if (error) throw error

      // Contabilidad (Fase 2b): si ya se cargó pagada, no tiene sentido pasar
      // por la CxP — se registra el pago directo desde Bancos, igual que un
      // pago instantáneo.
      if (yaPagada) {
        const { data: pago } = await sb.from('disabi_cpp_pagos').insert([{
          cpp_id: data.id, monto: montoNum, fecha: fecha_vence || fecha_emision || today(),
          notas: 'Registro histórico — ya pagada al momento de la carga',
        }]).select().single()

        if (pago) {
          await crearAsientoContable(sb, {
            fecha: fecha_vence || fecha_emision || today(),
            concepto: `CPP manual (ya pagada) — ${proveedor.trim()}`,
            origenTabla: 'disabi_cpp_pagos',
            origenId: pago.id,
            lineas: [
              { cuenta: cuentaGastoCpp, debe: montoNum, descripcion: referencia || `Gasto — ${proveedor.trim()}` },
              { cuenta: CUENTA.BANCOS, haber: montoNum, descripcion: 'Pago registrado manualmente' },
            ],
            creadoPor: user.id,
          })
        }
      } else {
        await crearAsientoContable(sb, {
          fecha: fecha_emision || today(),
          concepto: `CPP manual — ${proveedor.trim()}`,
          origenTabla: 'disabi_cpp',
          origenId: data.id,
          lineas: [
            { cuenta: cuentaGastoCpp, debe: montoNum, descripcion: referencia || `Gasto — ${proveedor.trim()}` },
            { cuenta: CUENTA.CXP_PROVEEDORES, haber: montoNum, descripcion: `CxP a ${proveedor.trim()}` },
          ],
          creadoPor: user.id,
        })
      }
      return NextResponse.json({ ok: true, id: data.id, numero })
    }

    // ── CPP: eliminar ────────────────────────────────────────────────────────
    if (action === 'delete_cpp') {
      const { id } = body
      const { data: cppExist } = await sb.from('disabi_cpp').select('fecha_emision').eq('id', id).single()
      const bloqueoDelCpp = await bloqueadoPorCierre(cppExist?.fecha_emision ?? '')
      if (bloqueoDelCpp) return NextResponse.json({ error: bloqueoDelCpp }, { status: 409 })

      // Contabilidad (Fase 2): no dejar huérfanos ni el asiento de creación de
      // esta CPP ni los de sus pagos — se borran junto, antes de borrar las
      // filas mismas.
      await borrarAsientoDeOrigen(sb, 'disabi_cpp', id)
      const { data: pagosDeLaCpp } = await sb.from('disabi_cpp_pagos').select('id').eq('cpp_id', id)
      if (pagosDeLaCpp?.length) {
        await borrarAsientosPorOrigenes(sb, 'disabi_cpp_pagos', pagosDeLaCpp.map(p => p.id))
      }

      await sb.from('disabi_cpp_pagos').delete().eq('cpp_id', id)
      const { error } = await sb.from('disabi_cpp').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (action === 'save_cpp_pago') {
      const { cpp_id, monto, fecha, notas } = body
      if (!cpp_id || !monto || monto <= 0)
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 })

      const bloqueoPagoCpp = await bloqueadoPorCierre(fecha || today())
      if (bloqueoPagoCpp) return NextResponse.json({ error: bloqueoPagoCpp }, { status: 409 })

      const { data: cpp } = await sb.from('disabi_cpp')
        .select('proveedor, monto_pendiente, monto_pagado, estado').eq('id', cpp_id).single()
      if (!cpp) return NextResponse.json({ error: 'CPP no encontrada' }, { status: 404 })

      const pagoMonto      = parseFloat(monto)
      const nuevoPendiente = Math.max(0, parseFloat(((cpp.monto_pendiente ?? 0) - pagoMonto).toFixed(2)))
      const nuevoPagado    = parseFloat(((cpp.monto_pagado ?? 0) + pagoMonto).toFixed(2))
      const nuevoEstado    = nuevoPendiente <= 0 ? 'Pagado' : 'Parcial'

      const { data: pago, error: pErr } = await sb.from('disabi_cpp_pagos').insert([{
        cpp_id, monto: pagoMonto, fecha: fecha || today(), notas: notas || null,
      }]).select().single()
      if (pErr) throw pErr

      const { error: uErr } = await sb.from('disabi_cpp').update({
        monto_pendiente: nuevoPendiente, monto_pagado: nuevoPagado, estado: nuevoEstado,
        fecha_pago: nuevoEstado === 'Pagado' ? (fecha || today()) : null,
      }).eq('id', cpp_id)
      if (uErr) throw uErr

      // Contabilidad (Fase 2): se paga al proveedor — sale de Bancos y se
      // reduce la Cuenta por Pagar. origenTabla es el propio pago (no la CPP)
      // por la misma razón que en save_cxc_abono: varios pagos de la misma
      // CPP no deben pisarse el asiento entre sí.
      await crearAsientoContable(sb, {
        fecha: fecha || today(),
        concepto: `Pago a ${cpp.proveedor} — CxP`,
        origenTabla: 'disabi_cpp_pagos',
        origenId: pago.id,
        lineas: [
          { cuenta: CUENTA.CXP_PROVEEDORES, debe:  pagoMonto, descripcion: `Pago a ${cpp.proveedor}` },
          { cuenta: CUENTA.BANCOS,          haber: pagoMonto, descripcion: 'Pago desde bancos' },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({ ok: true, nuevoPendiente, nuevoEstado })
    }

    // ── GASTO: guardar ──────────────────────────────────────────────────────
    if (action === 'save_gasto') {
      const { editId, fecha, categoria, descripcion, monto, factura, proveedor, tipo_egreso } = body
      if (!fecha || !monto || monto <= 0)
        return NextResponse.json({ error: 'Fecha y monto son requeridos' }, { status: 400 })

      const bloqueoGasto = await bloqueadoPorCierre(fecha)
      if (bloqueoGasto) return NextResponse.json({ error: bloqueoGasto }, { status: 409 })

      // tipo_egreso clasifica el gasto en el Estado de Resultados:
      // 'operativo'      → Gastos operativos variables
      // 'compra_local'   → Costo de Ventas (mercadería)
      // 'planilla'       → Planilla y honorarios (solo si se ingresa manualmente)
      // 'comision_venta' → Comisiones a vendedores (solo si se ingresa manualmente)
      // Si quien llama NO tiene el módulo Finanzas completo (p. ej. Ventas
      // usando el permiso angosto "gastos_variables"), se ignora lo que
      // mande el cliente y se fuerza 'operativo' — es la única clasificación
      // que ese permiso angosto autoriza.
      const tipoEgreso = tieneFinanzas ? (tipo_egreso || 'operativo') : 'operativo'

      const obj = {
        fecha, categoria: categoria || 'Otro',
        descripcion: descripcion || null,
        monto: parseFloat(monto),
        factura: factura || 'Sí',
        proveedor: proveedor || null,
        tipo_egreso: tipoEgreso,
      }

      // Contabilidad (Fase 2b): gasto operativo genérico registrado a mano en
      // Finanzas — no hay fecha de vencimiento en este formulario, así que se
      // asume pagado de contado. tipo_egreso ya clasifica el gasto para el
      // Estado de Resultados (arriba) — se reutiliza para saber contra qué
      // cuenta postear (ver CUENTA_POR_TIPO_EGRESO). Nota: esto NO aplica a
      // los gastos-puente que otros módulos insertan directo en disabi_gastos
      // (compra local, pago de planilla, pago de comisión) — esos ya postean
      // su propio asiento desde su propio endpoint.
      const cuentaGasto = CUENTA_POR_TIPO_EGRESO[tipoEgreso] ?? CUENTA.OTROS_GASTOS_OPERATIVOS

      let gastoIdSaved: string
      if (editId) {
        const { data: gastoExist } = await sb.from('disabi_gastos').select('fecha').eq('id', editId).single()
        const bloqueoGastoExist = await bloqueadoPorCierre(gastoExist?.fecha ?? '')
        if (bloqueoGastoExist) return NextResponse.json({ error: bloqueoGastoExist }, { status: 409 })

        const { error } = await sb.from('disabi_gastos').update(obj).eq('id', editId)
        if (error) throw error
        gastoIdSaved = editId
        await borrarAsientoDeOrigen(sb, 'disabi_gastos', gastoIdSaved)
      } else {
        const { data, error } = await sb.from('disabi_gastos').insert([obj]).select().single()
        if (error) throw error
        gastoIdSaved = data.id
      }

      await crearAsientoContable(sb, {
        fecha,
        concepto: `Gasto — ${descripcion || categoria || 'Otro'}${proveedor ? ' — ' + proveedor : ''}`,
        origenTabla: 'disabi_gastos',
        origenId: gastoIdSaved,
        lineas: [
          { cuenta: cuentaGasto, debe: parseFloat(monto), descripcion: descripcion || categoria || 'Gasto operativo' },
          { cuenta: CUENTA.BANCOS, haber: parseFloat(monto), descripcion: 'Pago de contado' },
        ],
        creadoPor: user.id,
      })

      return NextResponse.json({ ok: true, id: gastoIdSaved })
    }

    // ── GASTO: eliminar ─────────────────────────────────────────────────────
    if (action === 'delete_gasto') {
      const { id } = body
      const { data: gastoDel } = await sb.from('disabi_gastos').select('fecha').eq('id', id).single()
      const bloqueoDelGasto = await bloqueadoPorCierre(gastoDel?.fecha ?? '')
      if (bloqueoDelGasto) return NextResponse.json({ error: bloqueoDelGasto }, { status: 409 })

      // Contabilidad (Fase 2): no dejar huérfano el asiento de este gasto.
      await borrarAsientoDeOrigen(sb, 'disabi_gastos', id)

      const { error } = await sb.from('disabi_gastos').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── COSTO FIJO: guardar ─────────────────────────────────────────────────
    // Vigencia por fecha (vigente_desde / vigente_hasta): un costo fijo NO se
    // sobrescribe en sitio cuando cambia el monto — se cierra la versión anterior
    // (vigente_hasta) y se crea una nueva versión (vigente_desde = hoy). Así el
    // Estado de Resultados de meses ya pasados sigue usando el monto que estaba
    // vigente en ese momento, no el monto actual. Lo mismo aplica al desactivar:
    // se cierra la vigencia en vez de simplemente ocultarlo de todos los meses.
    if (action === 'save_costo_fijo') {
      const { editId, concepto, categoria, monto, frecuencia, vence_dia, proveedor, activo, notas, fecha_efectiva } = body
      if (!concepto?.trim() || !monto || monto <= 0)
        return NextResponse.json({ error: 'Concepto y monto son requeridos' }, { status: 400 })

      const montoNum = parseFloat(monto)
      const fechaEfectiva = fecha_efectiva || today()

      const bloqueoCF = await bloqueadoPorCierre(fechaEfectiva)
      if (bloqueoCF) return NextResponse.json({ error: bloqueoCF }, { status: 409 })

      const campos = {
        descripcion: concepto.trim(),
        categoria:   categoria || 'Otro',
        frecuencia:  frecuencia || 'Mensual',
        vence_dia:   vence_dia ? parseInt(vence_dia) : null,
        proveedor:   proveedor || null,
        notas:       notas || null,
      }

      if (editId) {
        const { data: actual } = await sb.from('disabi_costos_fijos').select('*').eq('id', editId).single()
        if (!actual) return NextResponse.json({ error: 'Costo fijo no encontrado' }, { status: 404 })

        const cambioMonto  = Math.abs((actual.monto ?? 0) - montoNum) > 0.001
        const seDesactiva  = actual.activo !== false && activo === false
        const seReactiva   = actual.activo === false && activo !== false

        if (cambioMonto) {
          // Cambió el monto → cerrar la versión vieja y abrir una nueva.
          const diaAnterior = new Date(fechaEfectiva)
          diaAnterior.setDate(diaAnterior.getDate() - 1)
          await sb.from('disabi_costos_fijos')
            .update({ vigente_hasta: diaAnterior.toISOString().slice(0, 10) })
            .eq('id', editId)

          const { data, error } = await sb.from('disabi_costos_fijos').insert([{
            ...campos, monto: montoNum, activo: activo !== false,
            vigente_desde: fechaEfectiva, vigente_hasta: null,
          }]).select().single()
          if (error) throw error
          return NextResponse.json({ ok: true, id: data.id, versionado: true })
        }

        if (seDesactiva) {
          // Ya no aplica desde la fecha efectiva → se cierra la vigencia (no se borra el historial).
          const { error } = await sb.from('disabi_costos_fijos')
            .update({ ...campos, monto: montoNum, activo: false, vigente_hasta: fechaEfectiva })
            .eq('id', editId)
          if (error) throw error
          return NextResponse.json({ ok: true, id: editId })
        }

        // Solo cambian datos informativos (proveedor, notas, etc.), o se reactiva.
        const { error } = await sb.from('disabi_costos_fijos')
          .update({ ...campos, monto: montoNum, activo: activo !== false, vigente_hasta: seReactiva ? null : actual.vigente_hasta })
          .eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      }

      // Nuevo costo fijo
      const { data, error } = await sb.from('disabi_costos_fijos').insert([{
        ...campos, monto: montoNum, activo: activo !== false,
        vigente_desde: fechaEfectiva, vigente_hasta: null,
      }]).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, id: data.id })
    }

    // ── COSTO FIJO: eliminar ────────────────────────────────────────────────
    // Solo permite borrar la versión abierta actual. Una versión ya cerrada
    // (vigente_hasta con fecha) es historial que sostiene el cálculo de meses
    // pasados — borrarla alteraría el Estado de Resultados de esos meses.
    if (action === 'delete_costo_fijo') {
      const { id } = body
      const { data: row } = await sb.from('disabi_costos_fijos').select('vigente_hasta').eq('id', id).single()
      if (row?.vigente_hasta) {
        return NextResponse.json({
          error: 'Este registro es historial de un costo fijo (quedó cerrado por un cambio de monto o una desactivación) y no se puede eliminar. Si ya no aplica, desactívalo en vez de eliminarlo.',
        }, { status: 400 })
      }
      const { error } = await sb.from('disabi_costos_fijos').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── COSTOS FIJOS: devengo contable del mes ──────────────────────────────
    // Contabilidad (Fase 2b): Costos Fijos no tiene ningún registro por
    // período — es una tabla de vigencia que el reporte lee al vuelo. Este
    // botón es el equivalente de "generar_planilla_mes" pero para Costos
    // Fijos: crea (o resincroniza, si ya se generó este período) una fila en
    // disabi_costos_fijos_devengos por cada costo fijo activo vigente en el
    // período, y postea su asiento. Se asume pagado de contado (Haber
    // Bancos) — Costos Fijos no tiene un flujo de "pendiente de pago" propio,
    // a diferencia de Planilla/Comisiones.
    if (action === 'generar_devengo_costos_fijos') {
      const { periodo } = body
      if (!periodo || !/^\d{4}-\d{2}$/.test(periodo))
        return NextResponse.json({ error: 'Período inválido (use YYYY-MM)' }, { status: 400 })

      const bloqueoDevengoCF = await bloqueadoPorCierre(periodo)
      if (bloqueoDevengoCF) return NextResponse.json({ error: bloqueoDevengoCF }, { status: 409 })

      const inicioMes = `${periodo}-01`
      const finMes    = finDeMes(periodo)

      // Vigentes en algún momento del período: empezaron antes/durante, y no
      // habían terminado antes de que el período empezara.
      const { data: costosFijos } = await sb.from('disabi_costos_fijos')
        .select('id, descripcion, categoria, monto')
        .eq('activo', true)
        .lte('vigente_desde', finMes)
        .or(`vigente_hasta.is.null,vigente_hasta.gte.${inicioMes}`)

      if (!costosFijos?.length) return NextResponse.json({ ok: true, generados: 0 })

      let generados = 0
      for (const cf of costosFijos) {
        const cuentaCF = CATEGORIA_COSTO_FIJO_CUENTA[cf.categoria ?? 'Otro'] ?? CUENTA.OTROS_GASTOS_OPERATIVOS

        const { data: devengo, error: devErr } = await sb.from('disabi_costos_fijos_devengos')
          .upsert({ costo_fijo_id: cf.id, periodo, monto: cf.monto }, { onConflict: 'costo_fijo_id,periodo' })
          .select().single()
        if (devErr || !devengo) continue

        await borrarAsientoDeOrigen(sb, 'disabi_costos_fijos_devengos', devengo.id)
        await crearAsientoContable(sb, {
          fecha: finMes,
          concepto: `Costo fijo ${periodo} — ${cf.descripcion}`,
          origenTabla: 'disabi_costos_fijos_devengos',
          origenId: devengo.id,
          lineas: [
            { cuenta: cuentaCF, debe: cf.monto, descripcion: cf.descripcion },
            { cuenta: CUENTA.BANCOS, haber: cf.monto, descripcion: 'Pago de contado' },
          ],
          creadoPor: user.id,
        })
        generados++
      }

      return NextResponse.json({ ok: true, generados })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/finanzas]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

// ── GET — datos del balance por mes seleccionado ─────────────────────────────
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoLectura(user.id, 'finanzas')))
    return NextResponse.json({ error: 'Tu rol no tiene acceso a Finanzas' }, { status: 403 })

  try {
    const url = new URL(req.url)
    const mes = url.searchParams.get('mes') || undefined
    if (mes && !/^\d{4}-\d{2}$/.test(mes))
      return NextResponse.json({ error: 'Formato inválido. Use YYYY-MM' }, { status: 400 })

    const { getFinanzasData } = await import('@/lib/clientes-finanzas-data')
    const d = await getFinanzasData(mes)
    return NextResponse.json({ ok: true, data: d })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

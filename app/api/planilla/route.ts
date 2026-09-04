import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { PLANILLA } from '@/lib/constants'

type TipoPago = 'empleado' | 'honorarios'

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

// Calcular ISR El Salvador (tabla simplificada 2024)
function calcISR(bruto: number): number {
  const anual = bruto * 12
  if (anual <= 4064)   return 0
  if (anual <= 9142.86) return Math.max(0, (bruto - 338.67) * 0.10)
  if (anual <= 22857.14) return Math.max(0, (bruto - 761.92) * 0.20)
  return Math.max(0, (bruto - 1904.76) * 0.30)
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  try {
    // ── EMPLEADO: guardar ───────────────────────────────────────────────────
    if (action === 'save_empleado') {
      const { editId, nombre, cargo, departamento, salario_base, fecha_ingreso, dui, nit, nup_isss, nup_afp, afp, activo } = body
      if (!nombre?.trim()) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })

      const obj = {
        nombre: nombre.trim(), cargo: cargo || null, departamento: departamento || null,
        salario_base: parseFloat(salario_base) || 0,
        fecha_ingreso: fecha_ingreso || null, dui: dui || null, nit: nit || null,
        nup_isss: nup_isss || null, nup_afp: nup_afp || null, afp: afp || null,
        activo: activo !== false,
      }

      if (editId) {
        const { error } = await sb.from('disabi_empleados').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId })
      } else {
        const { data, error } = await sb.from('disabi_empleados').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id })
      }
    }

    // ── EMPLEADO: eliminar (soft) ────────────────────────────────────────────
    if (action === 'delete_empleado') {
      const { id } = body
      const { error } = await sb.from('disabi_empleados').update({ activo: false }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── PLANILLA: generar registro mensual ──────────────────────────────────
    if (action === 'save_planilla_registro') {
      const { editId, empleado_id, periodo, salario_bruto, otras_deducciones, bonos, estado, fecha_pago, notas } = body
      if (!empleado_id || !periodo || !salario_bruto)
        return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })

      const bruto          = parseFloat(salario_bruto)
      const tipoPago: TipoPago = body.tipo_pago === 'honorarios' ? 'honorarios' : 'empleado'
      // Honorarios: solo retención ISR 10%, sin ISSS ni AFP (no hay relación laboral)
      const isssEmp        = tipoPago === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.ISSS_EMPLEADO).toFixed(2))
      const afpEmp         = tipoPago === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.AFP_EMPLEADO).toFixed(2))
      const renta          = tipoPago === 'honorarios'
        ? parseFloat((bruto * PLANILLA.RETENCION_HONORARIOS).toFixed(2))  // 10% fijo Art. 156 LISR
        : parseFloat(calcISR(bruto).toFixed(2))
      const otrasDeducc    = parseFloat(otras_deducciones ?? 0)
      const totalDeducc    = parseFloat((isssEmp + afpEmp + renta + otrasDeducc).toFixed(2))
      const bonosMonto     = parseFloat(bonos ?? 0)
      const salarioNeto    = parseFloat((bruto - totalDeducc + bonosMonto).toFixed(2))
      // Aporte patronal: 0 para honorarios (no hay obligación previsional)
      const isssPat        = tipoPago === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.ISSS_PATRONAL).toFixed(2))
      const afpPat         = tipoPago === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.AFP_PATRONAL).toFixed(2))
      const costoEmpresa   = parseFloat((bruto + isssPat + afpPat).toFixed(2))

      const obj = {
        empleado_id, periodo, tipo_pago: tipoPago, salario_bruto: bruto,
        isss_empleado: isssEmp, afp_empleado: afpEmp, renta,
        otras_deducciones: otrasDeducc, total_deducciones: totalDeducc,
        bonos: bonosMonto, salario_neto: salarioNeto,
        isss_patronal: isssPat, afp_patronal: afpPat,
        costo_total_empresa: costoEmpresa,
        estado: estado || 'Pendiente',
        fecha_pago: fecha_pago || null,
        notas: notas || null,
      }

      if (editId) {
        const { error } = await sb.from('disabi_planilla').update(obj).eq('id', editId)
        if (error) throw error
        return NextResponse.json({ ok: true, id: editId, calculo: { isssEmp, afpEmp, renta, totalDeducc, salarioNeto, isssPat, afpPat, costoEmpresa } })
      } else {
        const { data, error } = await sb.from('disabi_planilla').insert([obj]).select().single()
        if (error) throw error
        return NextResponse.json({ ok: true, id: data.id, calculo: { isssEmp, afpEmp, renta, totalDeducc, salarioNeto, isssPat, afpPat, costoEmpresa } })
      }
    }

    // ── PLANILLA: generar mes completo (todos los empleados) ────────────────
    if (action === 'generar_planilla_mes') {
      const { periodo } = body
      if (!periodo) return NextResponse.json({ error: 'Período requerido' }, { status: 400 })

      const { data: empleados } = await sb.from('disabi_empleados').select('*').eq('activo', true)
      if (!empleados?.length) return NextResponse.json({ error: 'No hay empleados activos' }, { status: 400 })

      const registros = empleados.map(e => {
        const bruto       = e.salario_base ?? 0
        const tp: TipoPago = (e as Record<string, unknown>).tipo_contrato === 'honorarios' ? 'honorarios' : 'empleado'
        const isssEmp     = tp === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.ISSS_EMPLEADO).toFixed(2))
        const afpEmp      = tp === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.AFP_EMPLEADO).toFixed(2))
        const renta       = tp === 'honorarios'
          ? parseFloat((bruto * PLANILLA.RETENCION_HONORARIOS).toFixed(2))
          : parseFloat(calcISR(bruto).toFixed(2))
        const totalDeducc = parseFloat((isssEmp + afpEmp + renta).toFixed(2))
        const salNeto     = parseFloat((bruto - totalDeducc).toFixed(2))
        const isssPat     = tp === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.ISSS_PATRONAL).toFixed(2))
        const afpPat      = tp === 'honorarios' ? 0 : parseFloat((bruto * PLANILLA.AFP_PATRONAL).toFixed(2))
        const costoEmp    = parseFloat((bruto + isssPat + afpPat).toFixed(2))
        return {
          empleado_id: e.id, periodo, tipo_pago: tp,
          salario_bruto: bruto, isss_empleado: isssEmp, afp_empleado: afpEmp, renta,
          otras_deducciones: 0, total_deducciones: totalDeducc, bonos: 0,
          salario_neto: salNeto, isss_patronal: isssPat, afp_patronal: afpPat,
          costo_total_empresa: costoEmp, estado: 'Pendiente',
        }
      })

      // Upsert — si ya existe el periodo+empleado, actualiza; si no, inserta
      const { error } = await sb.from('disabi_planilla')
        .upsert(registros, { onConflict: 'empleado_id,periodo', ignoreDuplicates: false })
      if (error) throw error

      return NextResponse.json({ ok: true, generados: registros.length })
    }

    // ── PLANILLA: marcar como pagado ────────────────────────────────────────
    if (action === 'pagar_planilla') {
      const { id, fecha_pago } = body
      const fp = fecha_pago || new Date().toISOString().slice(0, 10)

      // Leer el registro para saber el monto y empleado
      const { data: reg } = await sb.from('disabi_planilla')
        .select('*, empleado:disabi_empleados(nombre)')
        .eq('id', id).single()
      if (!reg) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

      const { error } = await sb.from('disabi_planilla')
        .update({ estado: 'Pagado', fecha_pago: fp })
        .eq('id', id)
      if (error) throw error

      // Puente financiero: registrar egreso real de caja en disabi_gastos
      const empNombre = (reg.empleado as { nombre?: string } | null)?.nombre ?? 'Empleado'
      const esTipo = reg.tipo_pago === 'honorarios' ? 'honorarios' : 'empleado'
      await sb.from('disabi_gastos').insert([{
        fecha:       fp,
        categoria:   esTipo === 'honorarios' ? 'Honorarios' : 'Planilla',
        descripcion: `Pago planilla ${reg.periodo} — ${empNombre} [id:${id}]`,
        monto:       reg.costo_total_empresa,
        factura:     'Sí',
        proveedor:   empNombre,
        tipo_egreso: 'planilla',
      }])

      return NextResponse.json({ ok: true })
    }

    // ── PLANILLA: marcar mes completo como pagado ───────────────────────────
    if (action === 'pagar_planilla_mes') {
      const { periodo, fecha_pago } = body
      const fp = fecha_pago || new Date().toISOString().slice(0, 10)

      // Leer todos los pendientes del período
      const { data: pendientes } = await sb.from('disabi_planilla')
        .select('id, costo_total_empresa, tipo_pago, empleado:disabi_empleados(nombre)')
        .eq('periodo', periodo).eq('estado', 'Pendiente')

      if (!pendientes?.length) return NextResponse.json({ ok: true, pagados: 0 })

      // Marcar como pagados
      const { error } = await sb.from('disabi_planilla')
        .update({ estado: 'Pagado', fecha_pago: fp })
        .eq('periodo', periodo).eq('estado', 'Pendiente')
      if (error) throw error

      // Puente financiero: un gasto por empleado
      const gastosInsert = pendientes.map(p => ({
        fecha:       fp,
        categoria:   p.tipo_pago === 'honorarios' ? 'Honorarios' : 'Planilla',
        descripcion: `Pago planilla ${periodo} — ${(p.empleado as { nombre?: string } | null)?.nombre ?? 'Empleado'} [id:${p.id}]`,
        monto:       p.costo_total_empresa,
        factura:     'Sí',
        proveedor:   (p.empleado as { nombre?: string } | null)?.nombre ?? 'Empleado',
        tipo_egreso: 'planilla',
      }))
      await sb.from('disabi_gastos').insert(gastosInsert)

      return NextResponse.json({ ok: true, pagados: pendientes.length })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })

  } catch (e: unknown) {
    console.error('[api/planilla]', e)
    return NextResponse.json({ error: 'Error del servidor' }, { status: 500 })
  }
}

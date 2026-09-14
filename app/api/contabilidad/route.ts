import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { today } from '@/lib/utils'
import { requirePermisoLectura, requirePermisoEscritura } from '@/lib/permisos-server'
import { bloqueadoPorCierre, periodoDeFecha } from '@/lib/cierre-server'
import { CORTE_CONTABLE, crearAsientoContable, borrarAsientoDeOrigen, finDeMes, CUENTA } from '@/lib/contabilidad-server'
import {
  getPlanCuentasMap, saldoTipo, grupoDe, asientosEnRango, partidasPorAsientoIds,
  diaSiguiente, calcularResultadoPeriodo, getUltimoCierreEjercicio, getCierresEjercicio,
  type PartidaRow,
} from '@/lib/contabilidad-reportes'

// ── Reportes sobre el libro contable (GET: Libro Diario, Libro Mayor, Balance
// de Comprobación, Balance General, Estado de Resultados, Activos Fijos) +
// las acciones que le permiten a un contador trabajar CON el sistema en vez
// de solo revisarlo (POST: asientos manuales, activos fijos + su
// depreciación mensual, y cierre de ejercicio). Todo lo demás del libro se
// sigue generando solo desde los módulos operativos — esto es
// específicamente para lo que NO tiene un origen operativo automático:
// provisiones, correcciones, reclasificaciones (asiento manual);
// depreciación de activos fijos (su propio flujo, con subledger propio —
// ver disabi_activos_fijos / disabi_depreciacion_devengos); y el cierre
// formal de cada ejercicio fiscal.

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 60
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoLectura(user.id, 'contabilidad')))
    return NextResponse.json({ error: 'Tu rol no tiene acceso a Contabilidad' }, { status: 403 })

  try {
    const url = new URL(req.url)
    const tipo = url.searchParams.get('tipo') || ''
    const desde = url.searchParams.get('desde') || CORTE_CONTABLE
    const hasta = url.searchParams.get('hasta') || today()

    // ── Plan de cuentas (para el selector de cuenta del Libro Mayor / asiento manual) ──
    if (tipo === 'plan_cuentas') {
      const mapa = await getPlanCuentasMap(sb)
      const cuentas = Object.values(mapa).filter(c => c.es_imputable).sort((a, b) => a.codigo.localeCompare(b.codigo))
      return NextResponse.json({ ok: true, cuentas })
    }

    // ── Libro Diario ───────────────────────────────────────────────────────
    if (tipo === 'diario') {
      const mapa = await getPlanCuentasMap(sb)
      const asientos = await asientosEnRango(sb, { desde, hasta })
      asientos.sort((a, b) => (a.fecha === b.fecha ? a.created_at.localeCompare(b.created_at) : a.fecha.localeCompare(b.fecha)))
      const ids = asientos.map(a => a.id)
      const partidas = await partidasPorAsientoIds(sb, ids)
      const porAsiento = new Map<string, PartidaRow[]>()
      for (const p of partidas) {
        const arr = porAsiento.get(p.asiento_id) ?? []
        arr.push(p)
        porAsiento.set(p.asiento_id, arr)
      }
      const resultado = asientos.map(a => ({
        id: a.id, fecha: a.fecha, concepto: a.concepto, origen_tabla: a.origen_tabla, origen_id: a.origen_id,
        lineas: (porAsiento.get(a.id) ?? []).map(p => ({
          cuenta_codigo: p.cuenta_codigo,
          cuenta_nombre: mapa[p.cuenta_codigo]?.nombre ?? p.cuenta_codigo,
          debe: p.debe, haber: p.haber, descripcion: p.descripcion,
        })),
      }))
      const totalDebe = partidas.reduce((a, p) => a + (p.debe ?? 0), 0)
      const totalHaber = partidas.reduce((a, p) => a + (p.haber ?? 0), 0)
      return NextResponse.json({ ok: true, desde, hasta, asientos: resultado, totalDebe, totalHaber })
    }

    // ── Libro Mayor (una cuenta) ──────────────────────────────────────────
    if (tipo === 'mayor') {
      const cuenta = url.searchParams.get('cuenta')
      if (!cuenta) return NextResponse.json({ error: 'Cuenta requerida' }, { status: 400 })
      const mapa = await getPlanCuentasMap(sb)
      const info = mapa[cuenta]
      if (!info) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

      const asientosPrevios = await asientosEnRango(sb, { desdeExclusive: desde })
      const partidasPrevias = await partidasPorAsientoIds(sb, asientosPrevios.map(a => a.id), cuenta)
      const debePrevio = partidasPrevias.reduce((a, p) => a + (p.debe ?? 0), 0)
      const haberPrevio = partidasPrevias.reduce((a, p) => a + (p.haber ?? 0), 0)
      const saldoInicial = parseFloat(saldoTipo(info.tipo, debePrevio, haberPrevio).toFixed(2))

      const asientosMov = await asientosEnRango(sb, { desde, hasta })
      const asientoMap = new Map(asientosMov.map(a => [a.id, a]))
      const partidasMov = await partidasPorAsientoIds(sb, asientosMov.map(a => a.id), cuenta)
      const movsOrdenados = partidasMov
        .map(p => ({ p, a: asientoMap.get(p.asiento_id)! }))
        .filter(x => x.a)
        .sort((x, y) => (x.a.fecha === y.a.fecha ? x.a.created_at.localeCompare(y.a.created_at) : x.a.fecha.localeCompare(y.a.fecha)))

      let saldo = saldoInicial
      const movimientos = movsOrdenados.map(({ p, a }) => {
        saldo = parseFloat((saldo + saldoTipo(info.tipo, p.debe ?? 0, p.haber ?? 0)).toFixed(2))
        return {
          fecha: a.fecha, concepto: a.concepto, origen_tabla: a.origen_tabla,
          descripcion: p.descripcion, debe: p.debe, haber: p.haber, saldo,
        }
      })

      return NextResponse.json({
        ok: true, desde, hasta,
        cuenta: { codigo: cuenta, nombre: info.nombre, tipo: info.tipo, naturaleza: info.naturaleza },
        saldoInicial, movimientos, saldoFinal: saldo,
      })
    }

    // ── Balance de Comprobación ───────────────────────────────────────────
    if (tipo === 'balance_comprobacion') {
      const mapa = await getPlanCuentasMap(sb)
      const asientos = await asientosEnRango(sb, { desde, hasta })
      const partidas = await partidasPorAsientoIds(sb, asientos.map(a => a.id))
      const agregados = new Map<string, { debe: number; haber: number }>()
      for (const p of partidas) {
        const cur = agregados.get(p.cuenta_codigo) ?? { debe: 0, haber: 0 }
        cur.debe += p.debe ?? 0; cur.haber += p.haber ?? 0
        agregados.set(p.cuenta_codigo, cur)
      }
      const cuentas = Array.from(agregados.entries())
        .map(([codigo, { debe, haber }]) => {
          const info = mapa[codigo]
          return {
            codigo, nombre: info?.nombre ?? codigo, tipo: info?.tipo ?? '',
            debe: parseFloat(debe.toFixed(2)), haber: parseFloat(haber.toFixed(2)),
            saldo: parseFloat(saldoTipo(info?.tipo ?? 'Activo', debe, haber).toFixed(2)),
          }
        })
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
      const totalDebe = parseFloat(cuentas.reduce((a, c) => a + c.debe, 0).toFixed(2))
      const totalHaber = parseFloat(cuentas.reduce((a, c) => a + c.haber, 0).toFixed(2))
      return NextResponse.json({ ok: true, desde, hasta, cuentas, totalDebe, totalHaber, cuadra: Math.abs(totalDebe - totalHaber) < 0.01 })
    }

    // ── Balance General (acumulado desde el corte contable hasta `hasta`) ────
    if (tipo === 'balance_general') {
      const mapa = await getPlanCuentasMap(sb)
      const ultimoCierre = await getUltimoCierreEjercicio(sb)
      // El Balance/Pasivo/Activo son siempre acumulados desde el corte — esas
      // cuentas nunca "cierran". Pero Ingreso/Costo/Gasto solo deben mostrar lo
      // acumulado DESDE EL ÚLTIMO CIERRE DE EJERCICIO (si hay uno) — lo anterior
      // a eso ya quedó resumido en Utilidades Retenidas vía disabi_cierres_ejercicio,
      // no se vuelve a sumar aquí para no contarlo dos veces.
      const desdePL = ultimoCierre ? diaSiguiente(ultimoCierre.fecha_hasta) : CORTE_CONTABLE

      const asientos = await asientosEnRango(sb, { desde: CORTE_CONTABLE, hasta })
      const asientoMap = new Map(asientos.map(a => [a.id, a]))
      const partidas = await partidasPorAsientoIds(sb, asientos.map(a => a.id))

      const agregadosBalance = new Map<string, { debe: number; haber: number }>() // Activo/Pasivo/Patrimonio: todo el rango
      const agregadosPL = new Map<string, { debe: number; haber: number }>()      // Ingreso/Costo/Gasto: solo desde desdePL
      for (const p of partidas) {
        const cur = agregadosBalance.get(p.cuenta_codigo) ?? { debe: 0, haber: 0 }
        cur.debe += p.debe ?? 0; cur.haber += p.haber ?? 0
        agregadosBalance.set(p.cuenta_codigo, cur)

        const a = asientoMap.get(p.asiento_id)
        if (a && a.fecha >= desdePL) {
          const curPL = agregadosPL.get(p.cuenta_codigo) ?? { debe: 0, haber: 0 }
          curPL.debe += p.debe ?? 0; curPL.haber += p.haber ?? 0
          agregadosPL.set(p.cuenta_codigo, curPL)
        }
      }

      type Linea = { grupo: string; codigo: string; nombre: string; saldo: number }
      const activos: Linea[] = [], pasivos: Linea[] = [], patrimonio: Linea[] = []

      for (const [codigo, { debe, haber }] of Array.from(agregadosBalance.entries())) {
        const info = mapa[codigo]
        if (!info || (info.tipo !== 'Activo' && info.tipo !== 'Pasivo' && info.tipo !== 'Patrimonio')) continue
        const saldo = parseFloat(saldoTipo(info.tipo, debe, haber).toFixed(2))
        if (Math.abs(saldo) < 0.005) continue
        if (info.tipo === 'Activo') activos.push({ grupo: grupoDe(codigo, mapa), codigo, nombre: info.nombre, saldo })
        else if (info.tipo === 'Pasivo') pasivos.push({ grupo: grupoDe(codigo, mapa), codigo, nombre: info.nombre, saldo })
        else patrimonio.push({ grupo: 'Patrimonio', codigo, nombre: info.nombre, saldo })
      }

      let netIngresos = 0, netCostos = 0, netGastos = 0
      for (const [codigo, { debe, haber }] of Array.from(agregadosPL.entries())) {
        const info = mapa[codigo]
        if (!info) continue
        const saldo = saldoTipo(info.tipo, debe, haber)
        if (info.tipo === 'Ingreso') netIngresos += saldo
        else if (info.tipo === 'Costo') netCostos += saldo
        else if (info.tipo === 'Gasto') netGastos += saldo
      }

      // Utilidad del ejercicio ACTUAL (todavía abierto) — línea calculada, igual
      // que antes, pero ahora acotada al período desde el último cierre.
      const utilidadEjercicioActual = parseFloat((netIngresos - netCostos - netGastos).toFixed(2))
      if (Math.abs(utilidadEjercicioActual) > 0.004) {
        patrimonio.push({ grupo: 'Patrimonio', codigo: '3103', nombre: 'Utilidad (Pérdida) del Ejercicio actual (calculada)', saldo: utilidadEjercicioActual })
      }

      // Utilidad de ejercicios YA cerrados — se suma directamente a la cuenta
      // 3102 Utilidades Retenidas (creando la línea si no existía con saldo
      // propio en el libro), sin volver a tocar los asientos históricos.
      const cierres = await getCierresEjercicio(sb)
      const utilidadCerrados = parseFloat(cierres.reduce((a, c) => a + c.utilidad_ejercicio, 0).toFixed(2))
      if (Math.abs(utilidadCerrados) > 0.004) {
        const existente = patrimonio.find(l => l.codigo === '3102')
        if (existente) existente.saldo = parseFloat((existente.saldo + utilidadCerrados).toFixed(2))
        else patrimonio.push({ grupo: 'Patrimonio', codigo: '3102', nombre: mapa['3102']?.nombre ?? 'Utilidades Retenidas', saldo: utilidadCerrados })
      }

      activos.sort((a, b) => a.codigo.localeCompare(b.codigo))
      pasivos.sort((a, b) => a.codigo.localeCompare(b.codigo))
      patrimonio.sort((a, b) => a.codigo.localeCompare(b.codigo))

      const totalActivo = parseFloat(activos.reduce((a, c) => a + c.saldo, 0).toFixed(2))
      const totalPasivo = parseFloat(pasivos.reduce((a, c) => a + c.saldo, 0).toFixed(2))
      const totalPatrimonio = parseFloat(patrimonio.reduce((a, c) => a + c.saldo, 0).toFixed(2))

      return NextResponse.json({
        ok: true, hasta,
        activos, pasivos, patrimonio,
        totalActivo, totalPasivo, totalPatrimonio,
        cuadra: Math.abs(totalActivo - (totalPasivo + totalPatrimonio)) < 0.01,
      })
    }

    // ── Estado de Resultados ──────────────────────────────────────────────
    if (tipo === 'estado_resultados') {
      const mapa = await getPlanCuentasMap(sb)
      const asientos = await asientosEnRango(sb, { desde, hasta })
      const partidas = await partidasPorAsientoIds(sb, asientos.map(a => a.id))
      const agregados = new Map<string, { debe: number; haber: number }>()
      for (const p of partidas) {
        const cur = agregados.get(p.cuenta_codigo) ?? { debe: 0, haber: 0 }
        cur.debe += p.debe ?? 0; cur.haber += p.haber ?? 0
        agregados.set(p.cuenta_codigo, cur)
      }

      type Linea = { codigo: string; nombre: string; monto: number }
      const ingresos: Linea[] = [], costos: Linea[] = []
      const gastosPorGrupo = new Map<string, Linea[]>()

      for (const [codigo, { debe, haber }] of Array.from(agregados.entries())) {
        const info = mapa[codigo]
        if (!info) continue
        const saldo = parseFloat(saldoTipo(info.tipo, debe, haber).toFixed(2))
        if (Math.abs(saldo) < 0.005) continue
        if (info.tipo === 'Ingreso') ingresos.push({ codigo, nombre: info.nombre, monto: saldo })
        else if (info.tipo === 'Costo') costos.push({ codigo, nombre: info.nombre, monto: saldo })
        else if (info.tipo === 'Gasto') {
          const grupo = grupoDe(codigo, mapa)
          const arr = gastosPorGrupo.get(grupo) ?? []
          arr.push({ codigo, nombre: info.nombre, monto: saldo })
          gastosPorGrupo.set(grupo, arr)
        }
      }
      ingresos.sort((a, b) => a.codigo.localeCompare(b.codigo))
      costos.sort((a, b) => a.codigo.localeCompare(b.codigo))

      const netIngresos = parseFloat(ingresos.reduce((a, l) => a + l.monto, 0).toFixed(2))
      const netCostos = parseFloat(costos.reduce((a, l) => a + l.monto, 0).toFixed(2))
      const utilidadBruta = parseFloat((netIngresos - netCostos).toFixed(2))

      const gastos = Array.from(gastosPorGrupo.entries())
        .map(([grupo, lineas]) => ({
          grupo,
          lineas: lineas.sort((a, b) => a.codigo.localeCompare(b.codigo)),
          subtotal: parseFloat(lineas.reduce((a, l) => a + l.monto, 0).toFixed(2)),
        }))
        .sort((a, b) => a.grupo.localeCompare(b.grupo))
      const netGastos = parseFloat(gastos.reduce((a, g) => a + g.subtotal, 0).toFixed(2))
      const utilidadOperativa = parseFloat((utilidadBruta - netGastos).toFixed(2))

      return NextResponse.json({
        ok: true, desde, hasta,
        ingresos, netIngresos, costos, netCostos, utilidadBruta,
        gastos, netGastos, utilidadOperativa,
      })
    }

    // ── Asientos manuales (listado) ───────────────────────────────────────
    if (tipo === 'manuales') {
      const { data: manuales, error } = await sb.from('disabi_asientos_manuales')
        .select('id, fecha, concepto, created_at').order('fecha', { ascending: false }).limit(100)
      if (error) throw error
      const ids = (manuales ?? []).map(m => m.id)
      if (!ids.length) return NextResponse.json({ ok: true, asientos: [] })

      const mapa = await getPlanCuentasMap(sb)
      const { data: asientosLedger, error: aErr } = await sb.from('disabi_asientos_contables')
        .select('id, origen_id').eq('origen_tabla', 'disabi_asientos_manuales').in('origen_id', ids)
      if (aErr) throw aErr
      const asientoIdPorOrigen = new Map((asientosLedger ?? []).map(a => [a.origen_id, a.id]))
      const partidas = await partidasPorAsientoIds(sb, (asientosLedger ?? []).map(a => a.id))
      const porAsiento = new Map<string, PartidaRow[]>()
      for (const p of partidas) {
        const arr = porAsiento.get(p.asiento_id) ?? []
        arr.push(p)
        porAsiento.set(p.asiento_id, arr)
      }

      const resultado = (manuales ?? []).map(m => {
        const asientoId = asientoIdPorOrigen.get(m.id)
        const lineas = (asientoId ? porAsiento.get(asientoId) : undefined) ?? []
        return {
          id: m.id, fecha: m.fecha, concepto: m.concepto,
          posteado: !!asientoId,
          lineas: lineas.map(p => ({
            cuenta_codigo: p.cuenta_codigo,
            cuenta_nombre: mapa[p.cuenta_codigo]?.nombre ?? p.cuenta_codigo,
            debe: p.debe, haber: p.haber, descripcion: p.descripcion,
          })),
        }
      })
      return NextResponse.json({ ok: true, asientos: resultado })
    }

    // ── Activos Fijos (listado con depreciación acumulada a la fecha) ─────
    // La acumulada NO se recalcula con una fórmula — es la suma de lo que
    // ya está realmente posteado en disabi_depreciacion_devengos (que a su
    // vez es lo que ya se contabilizó en el libro). Así el número que ve el
    // contador siempre coincide con lo que hay en Libro Mayor de 1202.
    if (tipo === 'activos_fijos') {
      const { data: activos, error } = await sb.from('disabi_activos_fijos')
        .select('id, nombre, fecha_adquisicion, costo, valor_residual, vida_util_meses, activo, fecha_baja, notas, created_at')
        .order('fecha_adquisicion', { ascending: false })
      if (error) throw error

      const ids = (activos ?? []).map(a => a.id)
      const acumuladaPorActivo = new Map<string, number>()
      let ultimoPeriodoGenerado: string | null = null
      if (ids.length) {
        const { data: devengos, error: dErr } = await sb.from('disabi_depreciacion_devengos')
          .select('activo_fijo_id, periodo, monto').in('activo_fijo_id', ids)
        if (dErr) throw dErr
        for (const d of devengos ?? []) {
          acumuladaPorActivo.set(d.activo_fijo_id, (acumuladaPorActivo.get(d.activo_fijo_id) ?? 0) + d.monto)
          if (!ultimoPeriodoGenerado || d.periodo > ultimoPeriodoGenerado) ultimoPeriodoGenerado = d.periodo
        }
      }

      const resultado = (activos ?? []).map(a => {
        const acumulada = parseFloat((acumuladaPorActivo.get(a.id) ?? 0).toFixed(2))
        const depreciable = parseFloat((a.costo - a.valor_residual).toFixed(2))
        const valorLibros = parseFloat((a.costo - acumulada).toFixed(2))
        return {
          ...a, acumulada, valorLibros,
          completado: acumulada >= depreciable - 0.01,
        }
      })

      return NextResponse.json({ ok: true, activos: resultado, ultimoPeriodoGenerado })
    }

    // ── Cierres de ejercicio (listado + info del período actual) ─────────
    if (tipo === 'cierres_ejercicio') {
      const cierres = await getCierresEjercicio(sb)
      const ultimo = cierres[0] ?? null
      const desdeActual = ultimo ? diaSiguiente(ultimo.fecha_hasta) : CORTE_CONTABLE
      const mapa = await getPlanCuentasMap(sb)
      const resultadoActual = await calcularResultadoPeriodo(sb, mapa, desdeActual, today())
      return NextResponse.json({ ok: true, cierres, periodoActual: { desde: desdeActual, hasta: today(), ...resultadoActual } })
    }

    return NextResponse.json({ error: 'Reporte no reconocido' }, { status: 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoEscritura(user.id, 'contabilidad')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para escribir en Contabilidad' }, { status: 403 })

  try {
    const body = await req.json()
    const { action } = body

    // ── Crear un asiento manual (depreciación, provisiones, correcciones,
    // reclasificaciones — todo lo que no tiene un origen operativo automático) ──
    if (action === 'crear_asiento_manual') {
      const { fecha, concepto, lineas } = body as {
        fecha: string; concepto: string
        lineas: { cuenta_codigo: string; debe?: number; haber?: number; descripcion?: string }[]
      }
      if (!fecha || !concepto?.trim()) return NextResponse.json({ error: 'Fecha y concepto son requeridos' }, { status: 400 })
      if (fecha < CORTE_CONTABLE)
        return NextResponse.json({ error: `El libro contable no registra nada antes del ${CORTE_CONTABLE}.` }, { status: 400 })
      const bloqueo = await bloqueadoPorCierre(fecha)
      if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 })

      const limpias = (lineas ?? []).filter(l => (l.debe ?? 0) > 0.004 || (l.haber ?? 0) > 0.004)
      if (limpias.length < 2) return NextResponse.json({ error: 'Se necesitan al menos 2 líneas con monto.' }, { status: 400 })

      const mapa = await getPlanCuentasMap(sb)
      for (const l of limpias) {
        const info = mapa[l.cuenta_codigo]
        if (!info) return NextResponse.json({ error: `La cuenta ${l.cuenta_codigo} no existe en el plan de cuentas.` }, { status: 400 })
        if (!info.es_imputable) return NextResponse.json({ error: `${l.cuenta_codigo} — ${info.nombre} es una cuenta de resumen, no se puede postear directamente ahí.` }, { status: 400 })
        if ((l.debe ?? 0) > 0.004 && (l.haber ?? 0) > 0.004)
          return NextResponse.json({ error: `${l.cuenta_codigo} tiene monto en Debe y en Haber a la vez — una línea va solo en un lado.` }, { status: 400 })
      }
      const totalDebe = limpias.reduce((a, l) => a + (l.debe ?? 0), 0)
      const totalHaber = limpias.reduce((a, l) => a + (l.haber ?? 0), 0)
      if (Math.abs(totalDebe - totalHaber) > 0.01)
        return NextResponse.json({ error: `El asiento no cuadra: Debe ${totalDebe.toFixed(2)} vs Haber ${totalHaber.toFixed(2)}.` }, { status: 400 })

      const { data: manual, error: mErr } = await sb.from('disabi_asientos_manuales')
        .insert([{ fecha, concepto: concepto.trim(), creado_por: user.id }]).select().single()
      if (mErr) throw mErr

      const asientoId = await crearAsientoContable(sb, {
        fecha, concepto: concepto.trim(), origenTabla: 'disabi_asientos_manuales', origenId: manual.id,
        lineas: limpias.map(l => ({ cuenta: l.cuenta_codigo, debe: l.debe, haber: l.haber, descripcion: l.descripcion })),
        creadoPor: user.id,
      })
      if (!asientoId) {
        await sb.from('disabi_asientos_manuales').delete().eq('id', manual.id)
        return NextResponse.json({ error: 'No se pudo contabilizar el asiento — revisa las líneas.' }, { status: 400 })
      }

      return NextResponse.json({ ok: true, id: manual.id, asientoId })
    }

    // ── Eliminar un asiento manual (no toca asientos generados automáticamente) ──
    if (action === 'eliminar_asiento_manual') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
      const { data: manual, error: gErr } = await sb.from('disabi_asientos_manuales').select('fecha').eq('id', id).maybeSingle()
      if (gErr) throw gErr
      if (!manual) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
      const bloqueo = await bloqueadoPorCierre(manual.fecha)
      if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 })

      await borrarAsientoDeOrigen(sb, 'disabi_asientos_manuales', id)
      const { error: dErr } = await sb.from('disabi_asientos_manuales').delete().eq('id', id)
      if (dErr) throw dErr
      return NextResponse.json({ ok: true })
    }

    // ── Cerrar ejercicio: calcula la utilidad del período abierto y lo marca
    // como cerrado. No revierte ni toca ningún asiento histórico — el Balance
    // General usa este registro para no volver a sumar ese período. ──────────
    if (action === 'cerrar_ejercicio') {
      const { fecha_hasta, notas } = body as { fecha_hasta: string; notas?: string }
      if (!fecha_hasta) return NextResponse.json({ error: 'fecha_hasta requerida' }, { status: 400 })

      const ultimo = await getUltimoCierreEjercicio(sb)
      const fecha_desde = ultimo ? diaSiguiente(ultimo.fecha_hasta) : CORTE_CONTABLE
      if (fecha_hasta <= fecha_desde)
        return NextResponse.json({ error: `La fecha de cierre debe ser posterior a ${fecha_desde} (inicio del ejercicio abierto).` }, { status: 400 })

      // El mes de la fecha de cierre debe estar ya cerrado en Finanzas — evita
      // cerrar un ejercicio cuyo último mes todavía puede recibir movimientos.
      const periodo = periodoDeFecha(fecha_hasta)
      const { data: cierreMes } = await sb.from('disabi_cierres_mensuales').select('id').eq('periodo', periodo).maybeSingle()
      if (!cierreMes)
        return NextResponse.json({ error: `Cierra primero el mes ${periodo} en Finanzas → Cierre Mensual antes de cerrar el ejercicio.` }, { status: 409 })

      const mapa = await getPlanCuentasMap(sb)
      const resultado = await calcularResultadoPeriodo(sb, mapa, fecha_desde, fecha_hasta)

      const { data: cierre, error } = await sb.from('disabi_cierres_ejercicio').insert([{
        fecha_desde, fecha_hasta,
        neto_ingresos: resultado.netIngresos, neto_costos: resultado.netCostos, neto_gastos: resultado.netGastos,
        utilidad_ejercicio: resultado.utilidad,
        notas: notas || null, cerrado_por: user.id,
      }]).select().single()
      if (error) {
        if (error.code === '23505') return NextResponse.json({ error: `Ya existe un cierre con fecha_hasta ${fecha_hasta}.` }, { status: 400 })
        throw error
      }

      return NextResponse.json({ ok: true, cierre })
    }

    // ── Reabrir el último ejercicio cerrado (solo el más reciente, para
    // corregir un error — no pensado para uso rutinario) ─────────────────
    if (action === 'reabrir_ejercicio') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
      const ultimo = await getUltimoCierreEjercicio(sb)
      if (!ultimo || ultimo.id !== id)
        return NextResponse.json({ error: 'Solo se puede reabrir el cierre de ejercicio más reciente.' }, { status: 400 })

      const { error } = await sb.from('disabi_cierres_ejercicio').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Activos Fijos: crear ──────────────────────────────────────────────
    if (action === 'crear_activo_fijo') {
      const { nombre, fecha_adquisicion, costo, valor_residual, vida_util_meses, notas } = body as {
        nombre: string; fecha_adquisicion: string; costo: number; valor_residual?: number; vida_util_meses: number; notas?: string
      }
      if (!nombre?.trim() || !fecha_adquisicion || !(costo > 0) || !(vida_util_meses > 0))
        return NextResponse.json({ error: 'Nombre, fecha de adquisición, costo y vida útil son requeridos.' }, { status: 400 })
      const vr = valor_residual ?? 0
      if (vr < 0 || vr >= costo)
        return NextResponse.json({ error: 'El valor residual debe ser menor al costo (puede ser 0).' }, { status: 400 })

      const { data, error } = await sb.from('disabi_activos_fijos').insert([{
        nombre: nombre.trim(), fecha_adquisicion, costo, valor_residual: vr, vida_util_meses,
        notas: notas?.trim() || null, creado_por: user.id,
      }]).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, activo: data })
    }

    // ── Activos Fijos: editar (nombre/notas siempre; costo/valor residual/
    // vida útil solo cambian el cálculo hacia adelante — lo ya devengado no
    // se toca) ─────────────────────────────────────────────────────────────
    if (action === 'editar_activo_fijo') {
      const { id, nombre, fecha_adquisicion, costo, valor_residual, vida_util_meses, notas } = body as {
        id: string; nombre: string; fecha_adquisicion: string; costo: number; valor_residual?: number; vida_util_meses: number; notas?: string
      }
      if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
      if (!nombre?.trim() || !fecha_adquisicion || !(costo > 0) || !(vida_util_meses > 0))
        return NextResponse.json({ error: 'Nombre, fecha de adquisición, costo y vida útil son requeridos.' }, { status: 400 })
      const vr = valor_residual ?? 0
      if (vr < 0 || vr >= costo)
        return NextResponse.json({ error: 'El valor residual debe ser menor al costo (puede ser 0).' }, { status: 400 })

      const { error } = await sb.from('disabi_activos_fijos').update({
        nombre: nombre.trim(), fecha_adquisicion, costo, valor_residual: vr, vida_util_meses,
        notas: notas?.trim() || null,
      }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Activos Fijos: dar de baja (deja de generar depreciación hacia
    // adelante, pero conserva su historial — no se borra) ─────────────────
    if (action === 'dar_baja_activo_fijo') {
      const { id, fecha_baja } = body as { id: string; fecha_baja: string }
      if (!id || !fecha_baja) return NextResponse.json({ error: 'id y fecha_baja son requeridos' }, { status: 400 })
      const { error } = await sb.from('disabi_activos_fijos').update({ activo: false, fecha_baja }).eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Activos Fijos: eliminar (solo si nunca se le generó depreciación —
    // si ya tiene historial, usa "dar de baja" en vez de borrar) ──────────
    if (action === 'eliminar_activo_fijo') {
      const { id } = body
      if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
      const { count } = await sb.from('disabi_depreciacion_devengos')
        .select('id', { count: 'exact', head: true }).eq('activo_fijo_id', id)
      if (count && count > 0)
        return NextResponse.json({ error: 'Este activo ya tiene depreciación contabilizada — no se puede eliminar. Si ya no aplica, dalo de baja.' }, { status: 400 })
      const { error } = await sb.from('disabi_activos_fijos').delete().eq('id', id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    // ── Activos Fijos: generar la depreciación de un período ──────────────
    // Mismo patrón que "generar_devengo_costos_fijos" de Finanzas: por cada
    // activo vigente en el período, calcula su cuota (línea recta) y
    // postea/resincroniza un asiento Debe 6205 / Haber 1202. Se puede volver
    // a presionar para el mismo período sin duplicar — recalcula y
    // resincroniza (útil si corriges un dato del activo antes de cerrar
    // el mes).
    if (action === 'generar_devengo_depreciacion') {
      const { periodo } = body as { periodo: string }
      if (!periodo || !/^\d{4}-\d{2}$/.test(periodo))
        return NextResponse.json({ error: 'Período inválido (use YYYY-MM)' }, { status: 400 })

      const bloqueo = await bloqueadoPorCierre(periodo)
      if (bloqueo) return NextResponse.json({ error: bloqueo }, { status: 409 })

      const finMes = finDeMes(periodo)
      if (finMes < CORTE_CONTABLE)
        return NextResponse.json({ error: `El libro contable no registra nada antes del ${CORTE_CONTABLE}.` }, { status: 400 })

      const inicioMes = `${periodo}-01`
      const { data: activos, error: aErr } = await sb.from('disabi_activos_fijos')
        .select('id, nombre, fecha_adquisicion, costo, valor_residual, vida_util_meses')
        .lte('fecha_adquisicion', finMes)
        .or(`fecha_baja.is.null,fecha_baja.gte.${inicioMes}`)
      if (aErr) throw aErr
      if (!activos?.length) return NextResponse.json({ ok: true, generados: 0 })

      const [py, pm] = periodo.split('-').map(Number)
      let generados = 0
      for (const act of activos) {
        const [ay, am] = act.fecha_adquisicion.slice(0, 7).split('-').map(Number)
        const mesesTranscurridos = (py * 12 + pm) - (ay * 12 + am) + 1
        if (mesesTranscurridos < 1 || mesesTranscurridos > act.vida_util_meses) continue // no inició, o ya completó su vida útil

        const depreciable = act.costo - act.valor_residual
        const cuotaBase = parseFloat((depreciable / act.vida_util_meses).toFixed(2))
        const monto = mesesTranscurridos === act.vida_util_meses
          ? parseFloat((depreciable - cuotaBase * (act.vida_util_meses - 1)).toFixed(2)) // último mes: ajusta el redondeo acumulado
          : cuotaBase
        if (monto <= 0.004) continue

        const { data: devengo, error: devErr } = await sb.from('disabi_depreciacion_devengos')
          .upsert({ activo_fijo_id: act.id, periodo, monto }, { onConflict: 'activo_fijo_id,periodo' })
          .select().single()
        if (devErr || !devengo) continue

        await borrarAsientoDeOrigen(sb, 'disabi_depreciacion_devengos', devengo.id)
        await crearAsientoContable(sb, {
          fecha: finMes,
          concepto: `Depreciación ${periodo} — ${act.nombre}`,
          origenTabla: 'disabi_depreciacion_devengos',
          origenId: devengo.id,
          lineas: [
            { cuenta: CUENTA.OTROS_GASTOS_OPERATIVOS, debe: monto, descripcion: act.nombre },
            { cuenta: CUENTA.DEPRECIACION_ACUMULADA, haber: monto, descripcion: act.nombre },
          ],
          creadoPor: user.id,
        })
        generados++
      }

      return NextResponse.json({ ok: true, generados })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

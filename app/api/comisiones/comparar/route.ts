import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase-server'
import { requirePermisoEscritura } from '@/lib/permisos-server'
import { calcularLineasComision } from '@/lib/comisiones-server'

// ══════════════════════════════════════════════════════════════════════════
// Comparar el Excel maestro de comisiones ("Cálculo automático de Comisiones
// DISABI") contra lo que el sistema calcula a partir de Ventas — NO reemplaza
// el cálculo automático (que sigue guiándose por disabi_comision_rangos), es
// una auditoría de un vistazo: ¿coincide lo que dice el Excel con lo que hay
// registrado en Ventas? Se calcula sobre TODO el negocio (sin filtrar por
// vendedor), porque el Excel tampoco distingue por vendedor.
// ══════════════════════════════════════════════════════════════════════════

const hits = new Map<string, number[]>()
function rateLimit(ip: string) {
  const now = Date.now()
  const prev = (hits.get(ip) ?? []).filter(t => now - t < 60000)
  prev.push(now); hits.set(ip, prev)
  return prev.length <= 30
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

interface LineaExcel { categoria: string; cantidad: number; comision: number }

// El Excel trae una fila por tramo de precio (no por venta): columna A =
// categoría (repetida en cada tramo), B = cantidad vendida en ese tramo,
// F = comisión de ese tramo (columna índice 5). Las filas de términos y
// condiciones al final no tienen un número en F, así que se descartan solas.
function parseHoja(ws: XLSX.WorkSheet): LineaExcel[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][]
  const lineas: LineaExcel[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const categoria = row[0]
    const cantidad = row[1]
    const comision = row[5]
    if (typeof categoria !== 'string' || !categoria.trim()) continue
    if (typeof comision !== 'number') continue
    lineas.push({
      categoria: categoria.trim(),
      cantidad: typeof cantidad === 'number' ? cantidad : 0,
      comision,
    })
  }
  return lineas
}

function elegirHoja(wb: XLSX.WorkBook, periodo: string): { hoja: XLSX.WorkSheet; nombre: string } {
  const [anio, mesNum] = periodo.split('-').map(Number)
  const nombreMes = MESES[(mesNum || 1) - 1] ?? MESES[0]
  const nombreEsperado = `${nombreMes} ${anio}`
  if (wb.SheetNames.includes(nombreEsperado)) {
    return { hoja: wb.Sheets[nombreEsperado], nombre: nombreEsperado }
  }
  const porMes = wb.SheetNames.find(n => n.toLowerCase().trim().startsWith(nombreMes.toLowerCase()))
  if (porMes) return { hoja: wb.Sheets[porMes], nombre: porMes }
  const primero = wb.SheetNames[0]
  return { hoja: wb.Sheets[primero], nombre: primero }
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Rate limit' }, { status: 429 })

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!(await requirePermisoEscritura(user.id, 'planilla')))
    return NextResponse.json({ error: 'Tu rol no tiene permiso para esta acción' }, { status: 403 })

  try {
    const form = await req.formData()
    const file = form.get('archivo')
    const periodo = String(form.get('periodo') || '')

    if (!(file instanceof File)) return NextResponse.json({ error: 'Archivo no recibido' }, { status: 400 })
    if (!/^\d{4}-\d{2}$/.test(periodo)) return NextResponse.json({ error: 'Período inválido' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Archivo muy grande (máx 10MB)' }, { status: 400 })

    const buf = Buffer.from(await file.arrayBuffer())
    let wb: XLSX.WorkBook
    try {
      wb = XLSX.read(buf, { type: 'buffer' })
    } catch {
      return NextResponse.json({ error: 'No se pudo leer el archivo — ¿es un Excel válido (.xlsx)?' }, { status: 400 })
    }

    const { hoja, nombre: hojaUsada } = elegirHoja(wb, periodo)
    const lineasExcel = parseHoja(hoja)

    if (lineasExcel.length === 0) {
      return NextResponse.json({
        error: `No se encontraron filas con datos en la hoja "${hojaUsada}". Verifica que sea el archivo de comisiones correcto.`,
      }, { status: 400 })
    }

    // Agrupar el Excel por categoría
    const excelPorCategoria = new Map<string, { cantidad: number; comision: number }>()
    for (const l of lineasExcel) {
      const acc = excelPorCategoria.get(l.categoria) ?? { cantidad: 0, comision: 0 }
      acc.cantidad += l.cantidad
      acc.comision += l.comision
      excelPorCategoria.set(l.categoria, acc)
    }

    // Calcular el lado del sistema (todo el negocio, sin filtrar por vendedor)
    const { lineas: lineasSistema, comisionBruta: comisionBrutaSistema } = await calcularLineasComision(sb, periodo)
    const sistemaPorCategoria = new Map<string, { cantidad: number; comision: number }>()
    for (const l of lineasSistema) {
      const acc = sistemaPorCategoria.get(l.categoria) ?? { cantidad: 0, comision: 0 }
      acc.cantidad += l.cantidad_vendida
      acc.comision += l.comision_linea
      sistemaPorCategoria.set(l.categoria, acc)
    }

    const todasCategorias = Array.from(excelPorCategoria.keys()).concat(Array.from(sistemaPorCategoria.keys()))
    const categorias = Array.from(new Set(todasCategorias)).sort()
    const comparacion = categorias.map(categoria => {
      const excel = excelPorCategoria.get(categoria) ?? { cantidad: 0, comision: 0 }
      const sistema = sistemaPorCategoria.get(categoria) ?? { cantidad: 0, comision: 0 }
      return {
        categoria,
        cantidad_excel: excel.cantidad,
        comision_excel: parseFloat(excel.comision.toFixed(2)),
        cantidad_sistema: sistema.cantidad,
        comision_sistema: parseFloat(sistema.comision.toFixed(2)),
        diferencia: parseFloat((sistema.comision - excel.comision).toFixed(2)),
      }
    })

    const comisionTotalExcel = parseFloat(
      Array.from(excelPorCategoria.values()).reduce((a, c) => a + c.comision, 0).toFixed(2)
    )

    return NextResponse.json({
      ok: true,
      hoja_usada: hojaUsada,
      periodo,
      comision_total_excel: comisionTotalExcel,
      comision_total_sistema: comisionBrutaSistema,
      diferencia_total: parseFloat((comisionBrutaSistema - comisionTotalExcel).toFixed(2)),
      comparacion,
    })
  } catch (e: unknown) {
    console.error('[api/comisiones/comparar]', e)
    return NextResponse.json({ error: 'Error al procesar el archivo' }, { status: 500 })
  }
}

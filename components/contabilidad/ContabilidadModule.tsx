'use client'
import { useState, useEffect, useCallback, Fragment } from 'react'
import { fmtUSD, today } from '@/lib/utils'
import { PERMISOS } from '@/lib/constants'
import type { Rol } from '@/lib/types'

// Debe coincidir con CORTE_CONTABLE de lib/contabilidad-server.ts — el libro
// contable no tiene nada antes de esta fecha, así que es el valor por defecto
// razonable para "desde" en todos los reportes.
const CORTE_CONTABLE = '2026-11-01'

type CuentaOpt = { codigo: string; nombre: string; tipo: string; naturaleza: string }

function Money({ v, strong }: { v: number; strong?: boolean }) {
  const neg = v < 0
  return (
    <span className="mono" style={{ color: neg ? 'var(--red)' : undefined, fontWeight: strong ? 700 : undefined }}>
      {neg ? '(' + fmtUSD(Math.abs(v)) + ')' : fmtUSD(v)}
    </span>
  )
}

function EstadoCarga({ loading, error, vacio }: { loading: boolean; error: string; vacio?: boolean }) {
  if (loading) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Cargando…</div>
  if (error) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--red)' }}>❌ {error}</div>
  if (vacio) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Sin movimientos en este rango.</div>
  return null
}

// ─── MÓDULO PRINCIPAL ───────────────────────────────────────────────────────
export default function ContabilidadModule({ rol }: { rol: Rol }) {
  type CTab = 'diario' | 'mayor' | 'comprobacion' | 'general' | 'resultados' | 'activos' | 'manual' | 'cierre'
  const [tab, setTab] = useState<CTab>('diario')
  const [desde, setDesde] = useState(CORTE_CONTABLE)
  const [hasta, setHasta] = useState(today())
  const puedeEscribir = PERMISOS[rol]?.contabilidad === true

  const TABS: { key: CTab; label: string }[] = [
    { key: 'diario',       label: '📖 Libro Diario' },
    { key: 'mayor',        label: '📚 Libro Mayor' },
    { key: 'comprobacion', label: '🧮 Balance de Comprobación' },
    { key: 'general',      label: '🏛️ Balance General' },
    { key: 'resultados',   label: '📊 Estado de Resultados' },
    { key: 'activos',      label: '🏗️ Activos Fijos' },
    { key: 'manual',       label: '✍️ Asiento Manual' },
    { key: 'cierre',       label: '🔒 Cierre de Ejercicio' },
  ]

  return (
    <div style={{ padding: 16 }}>
      <div className="card" style={{ marginBottom: 16, background: 'rgba(79,70,229,.05)', border: '1px solid rgba(79,70,229,.2)' }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>📒 Libro Contable</div>
        <p style={{ fontSize: 12, color: 'var(--txt3)' }}>
          Los reportes se generan solos a partir de lo que ya registras en Ventas, Compras, Finanzas, Planilla y
          Comisiones. &quot;Activos Fijos&quot;, &quot;Asiento Manual&quot; y &quot;Cierre de Ejercicio&quot; son las
          tres cosas que sí se capturan aquí — activos fijos y su depreciación mensual, provisiones y correcciones
          que no tienen origen automático, y el cierre formal de cada ejercicio fiscal. El libro arranca el{' '}
          {CORTE_CONTABLE} (fecha de corte contable).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'diario'       && <LibroDiarioTab desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />}
      {tab === 'mayor'        && <LibroMayorTab desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />}
      {tab === 'comprobacion' && <BalanceComprobacionTab desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />}
      {tab === 'general'      && <BalanceGeneralTab hasta={hasta} setHasta={setHasta} />}
      {tab === 'resultados'   && <EstadoResultadosTab desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />}
      {tab === 'activos'      && <ActivosFijosTab puedeEscribir={puedeEscribir} />}
      {tab === 'manual'       && <AsientoManualTab puedeEscribir={puedeEscribir} />}
      {tab === 'cierre'       && <CierreEjercicioTab puedeEscribir={puedeEscribir} />}
    </div>
  )
}

// ─── Filtro de fechas compartido ────────────────────────────────────────────
function FiltroFechas({ desde, hasta, setDesde, setHasta, soloHasta }: {
  desde?: string; hasta: string; setDesde?: (v: string) => void; setHasta: (v: string) => void; soloHasta?: boolean
}) {
  return (
    <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {!soloHasta && (
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde?.(e.target.value)} />
        </div>
      )}
      <div className="field" style={{ maxWidth: 170 }}>
        <label>{soloHasta ? 'Al día de' : 'Hasta'}</label>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
      </div>
    </div>
  )
}

// ─── Libro Diario ───────────────────────────────────────────────────────────
function LibroDiarioTab({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  type Linea = { cuenta_codigo: string; cuenta_nombre: string; debe: number; haber: number; descripcion: string | null }
  type Asiento = { id: string; fecha: string; concepto: string; origen_tabla: string; origen_id: string; lineas: Linea[] }
  const [data, setData] = useState<{ asientos: Asiento[]; totalDebe: number; totalHaber: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contabilidad?tipo=diario&desde=${desde}&hasta=${hasta}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div>
      <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <EstadoCarga loading={loading} error={error} vacio={!loading && !error && (data?.asientos.length ?? 0) === 0} />
      {!loading && !error && data && data.asientos.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>{data.asientos.length} asiento(s)</div>
          <table className="tbl">
            <thead>
              <tr><th>Fecha</th><th>Concepto / Cuenta</th><th>Origen</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th></tr>
            </thead>
            <tbody>
              {data.asientos.map(a => (
                <Fragment key={a.id}>
                  <tr style={{ background: 'rgba(79,70,229,.04)' }}>
                    <td className="mono" style={{ fontWeight: 700 }}>{a.fecha}</td>
                    <td style={{ fontWeight: 700 }} colSpan={1}>{a.concepto}</td>
                    <td style={{ fontSize: 10, color: 'var(--txt3)' }}>{a.origen_tabla}</td>
                    <td></td><td></td>
                  </tr>
                  {a.lineas.map((l, i) => (
                    <tr key={a.id + '-' + i}>
                      <td></td>
                      <td style={{ paddingLeft: 20 }}>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--txt3)', marginRight: 6 }}>{l.cuenta_codigo}</span>
                        {l.cuenta_nombre}
                        {l.descripcion && <span style={{ color: 'var(--txt3)', fontSize: 11 }}> — {l.descripcion}</span>}
                      </td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}>{l.debe > 0 ? <Money v={l.debe} /> : ''}</td>
                      <td style={{ textAlign: 'right' }}>{l.haber > 0 ? <Money v={l.haber} /> : ''}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                <td colSpan={3}>Totales</td>
                <td style={{ textAlign: 'right' }}><Money v={data.totalDebe} strong /></td>
                <td style={{ textAlign: 'right' }}><Money v={data.totalHaber} strong /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Libro Mayor ────────────────────────────────────────────────────────────
function LibroMayorTab({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  const [cuentas, setCuentas] = useState<CuentaOpt[]>([])
  const [cuentaSel, setCuentaSel] = useState('')
  type Mov = { fecha: string; concepto: string; origen_tabla: string; descripcion: string | null; debe: number; haber: number; saldo: number }
  const [data, setData] = useState<{ cuenta: CuentaOpt; saldoInicial: number; movimientos: Mov[]; saldoFinal: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/contabilidad?tipo=plan_cuentas').then(r => r.json()).then(d => {
      if (d.ok) {
        setCuentas(d.cuentas)
        if (d.cuentas.length > 0) setCuentaSel(d.cuentas[0].codigo)
      }
    }).catch(() => {})
  }, [])

  const cargar = useCallback(async () => {
    if (!cuentaSel) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contabilidad?tipo=mayor&cuenta=${cuentaSel}&desde=${desde}&hasta=${hasta}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [cuentaSel, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ maxWidth: 320, flex: 1 }}>
          <label>Cuenta</label>
          <select value={cuentaSel} onChange={e => setCuentaSel(e.target.value)}>
            {cuentas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>

      <EstadoCarga loading={loading} error={error} />
      {!loading && !error && data && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{data.cuenta.codigo} — {data.cuenta.nombre}</div>
            <div style={{ fontSize: 12 }}>Saldo inicial: <Money v={data.saldoInicial} /></div>
          </div>
          {data.movimientos.length === 0 ? (
            <div style={{ padding: 14, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Sin movimientos en este rango.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Fecha</th><th>Concepto</th><th>Origen</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th><th style={{ textAlign: 'right' }}>Saldo</th></tr>
              </thead>
              <tbody>
                {data.movimientos.map((m, i) => (
                  <tr key={i}>
                    <td className="mono">{m.fecha}</td>
                    <td>{m.concepto}{m.descripcion && <span style={{ color: 'var(--txt3)', fontSize: 11 }}> — {m.descripcion}</span>}</td>
                    <td style={{ fontSize: 10, color: 'var(--txt3)' }}>{m.origen_tabla}</td>
                    <td style={{ textAlign: 'right' }}>{m.debe > 0 ? <Money v={m.debe} /> : ''}</td>
                    <td style={{ textAlign: 'right' }}>{m.haber > 0 ? <Money v={m.haber} /> : ''}</td>
                    <td style={{ textAlign: 'right' }}><Money v={m.saldo} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                  <td colSpan={5}>Saldo final</td>
                  <td style={{ textAlign: 'right' }}><Money v={data.saldoFinal} strong /></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Balance de Comprobación ────────────────────────────────────────────────
function BalanceComprobacionTab({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  type Fila = { codigo: string; nombre: string; tipo: string; debe: number; haber: number; saldo: number }
  const [data, setData] = useState<{ cuentas: Fila[]; totalDebe: number; totalHaber: number; cuadra: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contabilidad?tipo=balance_comprobacion&desde=${desde}&hasta=${hasta}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div>
      <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <EstadoCarga loading={loading} error={error} vacio={!loading && !error && (data?.cuentas.length ?? 0) === 0} />
      {!loading && !error && data && data.cuentas.length > 0 && (
        <div className="card">
          <div style={{
            marginBottom: 10, fontSize: 12, fontWeight: 700,
            color: data.cuadra ? '#16a34a' : 'var(--red)',
          }}>
            {data.cuadra ? '✅ Cuadra (Total Debe = Total Haber)' : '❌ No cuadra — revisar'}
          </div>
          <table className="tbl">
            <thead>
              <tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th><th style={{ textAlign: 'right' }}>Saldo</th></tr>
            </thead>
            <tbody>
              {data.cuentas.map(c => (
                <tr key={c.codigo}>
                  <td className="mono" style={{ fontSize: 11 }}>{c.codigo}</td>
                  <td>{c.nombre}</td>
                  <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.tipo}</td>
                  <td style={{ textAlign: 'right' }}>{c.debe > 0 ? <Money v={c.debe} /> : ''}</td>
                  <td style={{ textAlign: 'right' }}>{c.haber > 0 ? <Money v={c.haber} /> : ''}</td>
                  <td style={{ textAlign: 'right' }}><Money v={c.saldo} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                <td colSpan={3}>Totales</td>
                <td style={{ textAlign: 'right' }}><Money v={data.totalDebe} strong /></td>
                <td style={{ textAlign: 'right' }}><Money v={data.totalHaber} strong /></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Balance General ────────────────────────────────────────────────────────
function BalanceGeneralTab({ hasta, setHasta }: { hasta: string; setHasta: (v: string) => void }) {
  type Linea = { grupo: string; codigo: string; nombre: string; saldo: number }
  const [data, setData] = useState<{ activos: Linea[]; pasivos: Linea[]; patrimonio: Linea[]; totalActivo: number; totalPasivo: number; totalPatrimonio: number; cuadra: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contabilidad?tipo=balance_general&hasta=${hasta}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [hasta])

  useEffect(() => { cargar() }, [cargar])

  function agrupar(lineas: Linea[]) {
    const porGrupo = new Map<string, Linea[]>()
    for (const l of lineas) {
      const arr = porGrupo.get(l.grupo) ?? []
      arr.push(l)
      porGrupo.set(l.grupo, arr)
    }
    return Array.from(porGrupo.entries())
  }

  return (
    <div>
      <FiltroFechas hasta={hasta} setHasta={setHasta} soloHasta />
      <EstadoCarga loading={loading} error={error} />
      {!loading && !error && data && (
        <>
          <div style={{
            marginBottom: 10, fontSize: 12, fontWeight: 700,
            color: data.cuadra ? '#16a34a' : 'var(--red)',
          }}>
            {data.cuadra ? '✅ Cuadra (Activo = Pasivo + Patrimonio)' : '❌ No cuadra — revisar'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Activo */}
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: 'var(--teal)' }}>ACTIVO</div>
              {data.activos.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Sin saldos.</div>}
              {agrupar(data.activos).map(([grupo, lineas]) => (
                <div key={grupo} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 4 }}>{grupo}</div>
                  {lineas.map(l => (
                    <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                      <span>{l.nombre}</span><Money v={l.saldo} />
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--bdr)', paddingTop: 8, marginTop: 6, fontWeight: 800, fontSize: 13 }}>
                <span>Total Activo</span><Money v={data.totalActivo} strong />
              </div>
            </div>

            {/* Pasivo + Patrimonio */}
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: 'var(--red)' }}>PASIVO</div>
              {data.pasivos.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 10 }}>Sin saldos.</div>}
              {agrupar(data.pasivos).map(([grupo, lineas]) => (
                <div key={grupo} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 4 }}>{grupo}</div>
                  {lineas.map(l => (
                    <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                      <span>{l.nombre}</span><Money v={l.saldo} />
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, marginBottom: 16 }}>
                <span>Total Pasivo</span><Money v={data.totalPasivo} strong />
              </div>

              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10, color: 'var(--indigo)' }}>PATRIMONIO</div>
              {data.patrimonio.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Sin saldos.</div>}
              {data.patrimonio.map(l => (
                <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                  <span>{l.nombre}</span><Money v={l.saldo} />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, marginBottom: 10 }}>
                <span>Total Patrimonio</span><Money v={data.totalPatrimonio} strong />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid var(--bdr)', paddingTop: 8, fontWeight: 800, fontSize: 13 }}>
                <span>Total Pasivo + Patrimonio</span><Money v={parseFloat((data.totalPasivo + data.totalPatrimonio).toFixed(2))} strong />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Estado de Resultados ───────────────────────────────────────────────────
function EstadoResultadosTab({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (v: string) => void; setHasta: (v: string) => void }) {
  type Linea = { codigo: string; nombre: string; monto: number }
  type Grupo = { grupo: string; lineas: Linea[]; subtotal: number }
  const [data, setData] = useState<{
    ingresos: Linea[]; netIngresos: number; costos: Linea[]; netCostos: number; utilidadBruta: number
    gastos: Grupo[]; netGastos: number; utilidadOperativa: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contabilidad?tipo=estado_resultados&desde=${desde}&hasta=${hasta}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div>
      <FiltroFechas desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      <EstadoCarga loading={loading} error={error} />
      {!loading && !error && data && (
        <div className="card" style={{ maxWidth: 640 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--txt3)', marginBottom: 4 }}>INGRESOS</div>
          {data.ingresos.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 8 }}>Sin movimientos.</div>}
          {data.ingresos.map(l => (
            <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
              <span>{l.nombre}</span><Money v={l.monto} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, borderTop: '1px solid var(--bdr)', paddingTop: 6, marginTop: 4, marginBottom: 14 }}>
            <span>Total Ingresos</span><Money v={data.netIngresos} strong />
          </div>

          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--txt3)', marginBottom: 4 }}>COSTO DE VENTAS</div>
          {data.costos.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 8 }}>Sin movimientos.</div>}
          {data.costos.map(l => (
            <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
              <span>{l.nombre}</span><Money v={l.monto} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, borderTop: '1px solid var(--bdr)', paddingTop: 6, marginTop: 4, marginBottom: 10 }}>
            <span>Total Costo de Ventas</span><Money v={data.netCostos} strong />
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 13,
            background: 'rgba(79,70,229,.06)', padding: '8px 10px', borderRadius: 6, marginBottom: 16,
          }}>
            <span>Utilidad Bruta</span><Money v={data.utilidadBruta} strong />
          </div>

          <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--txt3)', marginBottom: 4 }}>GASTOS OPERATIVOS</div>
          {data.gastos.length === 0 && <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 8 }}>Sin movimientos.</div>}
          {data.gastos.map(g => (
            <div key={g.grupo} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{g.grupo}</div>
              {g.lineas.map(l => (
                <div key={l.codigo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0 2px 10px' }}>
                  <span>{l.nombre}</span><Money v={l.monto} />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, padding: '2px 0 2px 10px', color: 'var(--txt3)' }}>
                <span>Subtotal {g.grupo}</span><Money v={g.subtotal} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12, borderTop: '1px solid var(--bdr)', paddingTop: 6, marginTop: 4, marginBottom: 14 }}>
            <span>Total Gastos Operativos</span><Money v={data.netGastos} strong />
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14,
            background: data.utilidadOperativa >= 0 ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)',
            padding: '10px 12px', borderRadius: 6,
          }}>
            <span>Utilidad {data.utilidadOperativa >= 0 ? 'Neta' : '(Pérdida) Neta'}</span>
            <Money v={data.utilidadOperativa} strong />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Activos Fijos ──────────────────────────────────────────────────────────
type ActivoForm = { nombre: string; fecha_adquisicion: string; costo: string; valor_residual: string; vida_util_meses: string; notas: string }
const ACTIVO_VACIO = (): ActivoForm => ({ nombre: '', fecha_adquisicion: today(), costo: '', valor_residual: '0', vida_util_meses: '60', notas: '' })

type ActivoFijo = {
  id: string; nombre: string; fecha_adquisicion: string; costo: number; valor_residual: number
  vida_util_meses: number; activo: boolean; fecha_baja: string | null; notas: string | null
  acumulada: number; valorLibros: number; completado: boolean
}

function mesSiguiente(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function ActivosFijosTab({ puedeEscribir }: { puedeEscribir: boolean }) {
  const [activos, setActivos] = useState<ActivoFijo[]>([])
  const [ultimoPeriodo, setUltimoPeriodo] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ActivoForm>(ACTIVO_VACIO())
  const [guardando, setGuardando] = useState(false)
  const [formError, setFormError] = useState('')

  const [periodo, setPeriodo] = useState(today().slice(0, 7))
  const [generando, setGenerando] = useState(false)
  const [genMsg, setGenMsg] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/contabilidad?tipo=activos_fijos')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setActivos(d.activos)
      setUltimoPeriodo(d.ultimoPeriodoGenerado)
      if (d.ultimoPeriodoGenerado) setPeriodo(mesSiguiente(d.ultimoPeriodoGenerado))
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  function editar(a: ActivoFijo) {
    setEditId(a.id)
    setForm({
      nombre: a.nombre, fecha_adquisicion: a.fecha_adquisicion, costo: String(a.costo),
      valor_residual: String(a.valor_residual), vida_util_meses: String(a.vida_util_meses),
      notas: a.notas ?? '',
    })
    setFormError('')
  }
  function cancelarEdicion() { setEditId(null); setForm(ACTIVO_VACIO()); setFormError('') }

  async function guardar() {
    setFormError('')
    const costo = parseFloat(form.costo), valorResidual = parseFloat(form.valor_residual) || 0, vida = parseInt(form.vida_util_meses, 10)
    if (!form.nombre.trim() || !form.fecha_adquisicion || !(costo > 0) || !(vida > 0))
      return setFormError('Nombre, fecha de adquisición, costo y vida útil son requeridos.')

    setGuardando(true)
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: editId ? 'editar_activo_fijo' : 'crear_activo_fijo',
          id: editId ?? undefined,
          nombre: form.nombre, fecha_adquisicion: form.fecha_adquisicion,
          costo, valor_residual: valorResidual, vida_util_meses: vida,
          notas: form.notas || undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      cancelarEdicion()
      cargar()
    } catch (e: unknown) { setFormError(e instanceof Error ? e.message : 'Error') }
    finally { setGuardando(false) }
  }

  async function darDeBaja(a: ActivoFijo) {
    const fecha = prompt(`Fecha de baja de "${a.nombre}" (YYYY-MM-DD):`, today())
    if (!fecha) return
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dar_baja_activo_fijo', id: a.id, fecha_baja: fecha }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      cargar()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  async function eliminar(a: ActivoFijo) {
    if (!confirm(`¿Eliminar "${a.nombre}"? Solo se puede si nunca se le generó depreciación.`)) return
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'eliminar_activo_fijo', id: a.id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      cargar()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  async function generarDepreciacion() {
    setGenMsg('')
    if (!confirm(`¿Generar/resincronizar la depreciación de ${periodo} para todos los activos vigentes?`)) return
    setGenerando(true)
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generar_devengo_depreciacion', periodo }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setGenMsg(d.generados > 0 ? `✅ ${d.generados} activo(s) depreciado(s) para ${periodo}` : 'ℹ️ Ningún activo tenía depreciación que generar en ese período.')
      cargar()
    } catch (e: unknown) { setGenMsg('❌ ' + (e instanceof Error ? e.message : 'Error')) }
    finally { setGenerando(false) }
  }

  return (
    <div>
      {puedeEscribir && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
            {editId ? '✏️ Editar activo fijo' : '🏗️ Nuevo activo fijo'}
          </div>
          {formError && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12, background: 'rgba(220,38,38,.08)', color: 'var(--red)' }}>❌ {formError}</div>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label>Nombre</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Mobiliario de local" />
            </div>
            <div className="field" style={{ maxWidth: 170 }}>
              <label>Fecha de adquisición</label>
              <input type="date" value={form.fecha_adquisicion} onChange={e => setForm(f => ({ ...f, fecha_adquisicion: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Costo</label>
              <input type="number" step="0.01" value={form.costo} onChange={e => setForm(f => ({ ...f, costo: e.target.value }))} />
            </div>
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Valor residual</label>
              <input type="number" step="0.01" value={form.valor_residual} onChange={e => setForm(f => ({ ...f, valor_residual: e.target.value }))} />
            </div>
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Vida útil (meses)</label>
              <input type="number" step="1" value={form.vida_util_meses} onChange={e => setForm(f => ({ ...f, vida_util_meses: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Notas (opcional)</label>
              <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : editId ? '💾 Guardar cambios' : '➕ Registrar activo'}
            </button>
            {editId && <button className="btn btn-sm" onClick={cancelarEdicion}>Cancelar</button>}
          </div>
        </div>
      )}

      {puedeEscribir && (
        <div className="card" style={{ marginBottom: 16, background: 'rgba(79,70,229,.05)', border: '1px solid rgba(79,70,229,.2)' }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📉 Generar depreciación del mes</div>
          <p style={{ fontSize: 11.5, color: 'var(--txt3)', marginBottom: 10 }}>
            Calcula la cuota de línea recta de cada activo vigente en el período y postea (o resincroniza) el asiento
            Debe 6205 Otros Gastos Operativos / Haber 1202 Depreciación Acumulada. Se puede repetir sin duplicar.
            {ultimoPeriodo && <> Último período generado: <span className="mono">{ultimoPeriodo}</span>.</>}
          </p>
          {genMsg && <div style={{ fontSize: 12, marginBottom: 10 }}>{genMsg}</div>}
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ maxWidth: 160 }}>
              <label>Período</label>
              <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={generarDepreciacion} disabled={generando}>
              {generando ? 'Generando…' : '📉 Generar Depreciación'}
            </button>
          </div>
        </div>
      )}

      <EstadoCarga loading={loading} error={error} vacio={!loading && !error && activos.length === 0} />
      {!loading && !error && activos.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Activos registrados</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Nombre</th><th>Adquisición</th><th style={{ textAlign: 'right' }}>Costo</th>
                <th style={{ textAlign: 'right' }}>Vida útil</th><th style={{ textAlign: 'right' }}>Acumulada</th>
                <th style={{ textAlign: 'right' }}>Valor en libros</th><th>Estado</th>{puedeEscribir && <th></th>}
              </tr>
            </thead>
            <tbody>
              {activos.map(a => (
                <tr key={a.id} style={{ opacity: a.activo ? 1 : 0.55 }}>
                  <td>{a.nombre}{a.notas && <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{a.notas}</div>}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{a.fecha_adquisicion}</td>
                  <td style={{ textAlign: 'right' }}><Money v={a.costo} /></td>
                  <td style={{ textAlign: 'right' }} className="mono">{a.vida_util_meses}m</td>
                  <td style={{ textAlign: 'right' }}><Money v={a.acumulada} /></td>
                  <td style={{ textAlign: 'right' }}><Money v={a.valorLibros} strong /></td>
                  <td style={{ fontSize: 10 }}>
                    {!a.activo ? <span style={{ color: 'var(--txt3)' }}>Dado de baja {a.fecha_baja}</span>
                      : a.completado ? <span style={{ color: '#16a34a' }}>Completado</span>
                      : <span style={{ color: 'var(--indigo)' }}>En curso</span>}
                  </td>
                  {puedeEscribir && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" onClick={() => editar(a)} style={{ padding: '2px 8px', marginRight: 4 }}>✏️</button>
                      {a.activo && <button className="btn btn-sm" onClick={() => darDeBaja(a)} style={{ padding: '2px 8px', marginRight: 4 }}>📤</button>}
                      {a.acumulada === 0 && <button className="btn btn-sm" onClick={() => eliminar(a)} style={{ padding: '2px 8px' }}>🗑️</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Asiento Manual ─────────────────────────────────────────────────────────
type LineaForm = { cuenta_codigo: string; debe: string; haber: string; descripcion: string }
const LINEA_VACIA = (): LineaForm => ({ cuenta_codigo: '', debe: '', haber: '', descripcion: '' })

function AsientoManualTab({ puedeEscribir }: { puedeEscribir: boolean }) {
  type ManualLinea = { cuenta_codigo: string; cuenta_nombre: string; debe: number; haber: number; descripcion: string | null }
  type Manual = { id: string; fecha: string; concepto: string; posteado: boolean; lineas: ManualLinea[] }

  const [cuentas, setCuentas] = useState<CuentaOpt[]>([])
  const [fecha, setFecha] = useState(today())
  const [concepto, setConcepto] = useState('')
  const [lineas, setLineas] = useState<LineaForm[]>([LINEA_VACIA(), LINEA_VACIA()])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [manuales, setManuales] = useState<Manual[]>([])
  const [loadingLista, setLoadingLista] = useState(true)

  useEffect(() => {
    fetch('/api/contabilidad?tipo=plan_cuentas').then(r => r.json()).then(d => { if (d.ok) setCuentas(d.cuentas) }).catch(() => {})
  }, [])

  const cargarManuales = useCallback(async () => {
    setLoadingLista(true)
    try {
      const res = await fetch('/api/contabilidad?tipo=manuales')
      const d = await res.json()
      if (d.ok) setManuales(d.asientos)
    } catch { /* silencioso */ }
    finally { setLoadingLista(false) }
  }, [])
  useEffect(() => { cargarManuales() }, [cargarManuales])

  const totalDebe = lineas.reduce((a, l) => a + (parseFloat(l.debe) || 0), 0)
  const totalHaber = lineas.reduce((a, l) => a + (parseFloat(l.haber) || 0), 0)
  const cuadra = Math.abs(totalDebe - totalHaber) < 0.01 && totalDebe > 0

  function actualizarLinea(i: number, cambios: Partial<LineaForm>) {
    setLineas(prev => prev.map((l, idx) => idx === i ? { ...l, ...cambios } : l))
  }
  function agregarLinea() { setLineas(prev => [...prev, LINEA_VACIA()]) }
  function quitarLinea(i: number) { setLineas(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev) }

  async function guardar() {
    setError(''); setOk('')
    if (!concepto.trim()) return setError('El concepto es requerido')
    if (!cuadra) return setError('El asiento no cuadra — Debe y Haber deben ser iguales')
    const lineasValidas = lineas.filter(l => l.cuenta_codigo && (parseFloat(l.debe) > 0 || parseFloat(l.haber) > 0))
    if (lineasValidas.length < 2) return setError('Se necesitan al menos 2 líneas con cuenta y monto')

    setGuardando(true)
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'crear_asiento_manual', fecha, concepto,
          lineas: lineasValidas.map(l => ({
            cuenta_codigo: l.cuenta_codigo,
            debe: parseFloat(l.debe) || 0, haber: parseFloat(l.haber) || 0,
            descripcion: l.descripcion || undefined,
          })),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setOk('✅ Asiento contabilizado')
      setConcepto(''); setLineas([LINEA_VACIA(), LINEA_VACIA()])
      cargarManuales()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setGuardando(false) }
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este asiento manual? Esto quita también sus partidas del libro.')) return
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'eliminar_asiento_manual', id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      cargarManuales()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  if (!puedeEscribir) {
    return (
      <div>
        <div className="card" style={{ marginBottom: 14, fontSize: 12, color: 'var(--txt3)' }}>
          Tu rol tiene acceso de solo lectura a Contabilidad — no puede capturar asientos manuales.
        </div>
        <ListaManuales manuales={manuales} loading={loadingLista} onEliminar={null} />
      </div>
    )
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>✍️ Nuevo asiento manual</div>
        {error && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12, background: 'rgba(220,38,38,.08)', color: 'var(--red)' }}>❌ {error}</div>}
        {ok && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12, background: 'rgba(22,163,74,.08)', color: '#16a34a' }}>{ok}</div>}

        <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Concepto</label>
            <input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej: Depreciación mensual mobiliario" />
          </div>
        </div>

        <table className="tbl" style={{ marginBottom: 10 }}>
          <thead>
            <tr><th>Cuenta</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th><th></th></tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 220 }}>
                  <select value={l.cuenta_codigo} onChange={e => actualizarLinea(i, { cuenta_codigo: e.target.value })}>
                    <option value="">— Selecciona —</option>
                    {cuentas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.nombre}</option>)}
                  </select>
                </td>
                <td><input value={l.descripcion} onChange={e => actualizarLinea(i, { descripcion: e.target.value })} placeholder="Opcional" /></td>
                <td style={{ maxWidth: 110 }}>
                  <input type="number" step="0.01" value={l.debe} onChange={e => actualizarLinea(i, { debe: e.target.value, haber: e.target.value ? '' : l.haber })} style={{ textAlign: 'right' }} />
                </td>
                <td style={{ maxWidth: 110 }}>
                  <input type="number" step="0.01" value={l.haber} onChange={e => actualizarLinea(i, { haber: e.target.value, debe: e.target.value ? '' : l.debe })} style={{ textAlign: 'right' }} />
                </td>
                <td>
                  {lineas.length > 2 && <button className="btn btn-sm" onClick={() => quitarLinea(i)} style={{ padding: '2px 8px' }}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--bdr)' }}>
              <td colSpan={2}>Totales</td>
              <td style={{ textAlign: 'right' }}><Money v={totalDebe} strong /></td>
              <td style={{ textAlign: 'right' }}><Money v={totalHaber} strong /></td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={agregarLinea}>+ Agregar línea</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: cuadra ? '#16a34a' : 'var(--red)' }}>
              {cuadra ? '✅ Cuadra' : totalDebe > 0 || totalHaber > 0 ? '❌ No cuadra' : ''}
            </span>
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando || !cuadra}>
              {guardando ? 'Guardando…' : '💾 Contabilizar'}
            </button>
          </div>
        </div>
      </div>

      <ListaManuales manuales={manuales} loading={loadingLista} onEliminar={eliminar} />
    </div>
  )
}

function ListaManuales({ manuales, loading, onEliminar }: {
  manuales: { id: string; fecha: string; concepto: string; posteado: boolean; lineas: { cuenta_codigo: string; cuenta_nombre: string; debe: number; haber: number; descripcion: string | null }[] }[]
  loading: boolean
  onEliminar: ((id: string) => void) | null
}) {
  if (loading) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Cargando…</div>
  if (manuales.length === 0) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Todavía no hay asientos manuales.</div>
  return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Últimos asientos manuales</div>
      <table className="tbl">
        <thead><tr><th>Fecha</th><th>Concepto / Cuenta</th><th style={{ textAlign: 'right' }}>Debe</th><th style={{ textAlign: 'right' }}>Haber</th><th></th></tr></thead>
        <tbody>
          {manuales.map(m => (
            <Fragment key={m.id}>
              <tr style={{ background: 'rgba(79,70,229,.04)' }}>
                <td className="mono" style={{ fontWeight: 700 }}>{m.fecha}</td>
                <td style={{ fontWeight: 700 }}>{m.concepto}{!m.posteado && <span style={{ color: 'var(--red)', fontSize: 10 }}> — no contabilizado</span>}</td>
                <td></td><td></td>
                <td>{onEliminar && <button className="btn btn-sm" onClick={() => onEliminar(m.id)} style={{ padding: '2px 8px' }}>🗑️</button>}</td>
              </tr>
              {m.lineas.map((l, i) => (
                <tr key={m.id + '-' + i}>
                  <td></td>
                  <td style={{ paddingLeft: 20 }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--txt3)', marginRight: 6 }}>{l.cuenta_codigo}</span>
                    {l.cuenta_nombre}
                  </td>
                  <td style={{ textAlign: 'right' }}>{l.debe > 0 ? <Money v={l.debe} /> : ''}</td>
                  <td style={{ textAlign: 'right' }}>{l.haber > 0 ? <Money v={l.haber} /> : ''}</td>
                  <td></td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Cierre de Ejercicio ────────────────────────────────────────────────────
function CierreEjercicioTab({ puedeEscribir }: { puedeEscribir: boolean }) {
  type Cierre = { id: string; fecha_desde: string; fecha_hasta: string; neto_ingresos: number; neto_costos: number; neto_gastos: number; utilidad_ejercicio: number; notas: string | null; created_at: string }
  type Periodo = { desde: string; hasta: string; netIngresos: number; netCostos: number; netGastos: number; utilidad: number }

  const [cierres, setCierres] = useState<Cierre[]>([])
  const [periodoActual, setPeriodoActual] = useState<Periodo | null>(null)
  const [loading, setLoading] = useState(true)
  const [fechaHasta, setFechaHasta] = useState(today())
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contabilidad?tipo=cierres_ejercicio')
      const d = await res.json()
      if (d.ok) { setCierres(d.cierres); setPeriodoActual(d.periodoActual) }
    } catch { /* silencioso */ }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { cargar() }, [cargar])

  async function cerrar() {
    setError('')
    if (!confirm(`¿Cerrar el ejercicio del ${periodoActual?.desde} al ${fechaHasta}?\n\nEsto queda registrado permanentemente — la utilidad de ese período se traslada a Utilidades Retenidas y no se puede volver a incluir en el Estado de Resultados de otro período.`)) return
    setGuardando(true)
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cerrar_ejercicio', fecha_hasta: fechaHasta, notas }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setNotas('')
      cargar()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') }
    finally { setGuardando(false) }
  }

  async function reabrir(id: string) {
    if (!confirm('¿Reabrir este cierre de ejercicio? Solo hazlo para corregir un error.')) return
    try {
      const res = await fetch('/api/contabilidad', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reabrir_ejercicio', id }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      cargar()
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error') }
  }

  if (loading) return <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>Cargando…</div>

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Ejercicio actual (abierto)</div>
        {periodoActual && (
          <>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 10 }}>
              Desde {periodoActual.desde} hasta hoy ({periodoActual.hasta})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
              <div className="kpi-card"><div className="kpi-label">Ingresos</div><div className="kpi-value" style={{ fontSize: 15 }}><Money v={periodoActual.netIngresos} /></div></div>
              <div className="kpi-card"><div className="kpi-label">Costos</div><div className="kpi-value" style={{ fontSize: 15 }}><Money v={periodoActual.netCostos} /></div></div>
              <div className="kpi-card"><div className="kpi-label">Gastos</div><div className="kpi-value" style={{ fontSize: 15 }}><Money v={periodoActual.netGastos} /></div></div>
              <div className="kpi-card" style={{ borderTop: '3px solid var(--indigo)' }}><div className="kpi-label">Utilidad del período</div><div className="kpi-value" style={{ fontSize: 15 }}><Money v={periodoActual.utilidad} strong /></div></div>
            </div>
          </>
        )}

        {!puedeEscribir ? (
          <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Tu rol tiene acceso de solo lectura a Contabilidad — no puede cerrar el ejercicio.</div>
        ) : (
          <>
            {error && <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 10, fontSize: 12, background: 'rgba(220,38,38,.08)', color: 'var(--red)' }}>❌ {error}</div>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ maxWidth: 170 }}>
                <label>Cerrar hasta</label>
                <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}>
                <label>Notas (opcional)</label>
                <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Ej: Cierre fiscal 2026" />
              </div>
              <button className="btn btn-primary btn-sm" onClick={cerrar} disabled={guardando}>
                {guardando ? 'Cerrando…' : '🔒 Cerrar Ejercicio'}
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8 }}>
              El mes de la fecha de cierre debe estar ya cerrado en Finanzas → Cierre Mensual.
            </p>
          </>
        )}
      </div>

      {cierres.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Ejercicios cerrados</div>
          <table className="tbl">
            <thead><tr><th>Desde</th><th>Hasta</th><th style={{ textAlign: 'right' }}>Utilidad</th><th>Notas</th><th></th></tr></thead>
            <tbody>
              {cierres.map((c, i) => (
                <tr key={c.id}>
                  <td className="mono">{c.fecha_desde}</td>
                  <td className="mono">{c.fecha_hasta}</td>
                  <td style={{ textAlign: 'right' }}><Money v={c.utilidad_ejercicio} strong /></td>
                  <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.notas || '—'}</td>
                  <td>
                    {i === 0 && puedeEscribir && (
                      <button className="btn btn-sm" onClick={() => reabrir(c.id)} style={{ padding: '2px 8px', fontSize: 10 }}>Reabrir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

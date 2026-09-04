'use client'
import ConciliacionTab from './ConciliacionTab'
import { useState } from 'react'
import { fmtUSD, today, monthLabel } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface CXCRow { id: string; numero?: string; cliente: string; fecha_emision: string; fecha_vence?: string; monto: number; saldo: number; estado: string }
interface CPPRow { id: string; numero?: string; proveedor: string; fecha_emision: string; fecha_vence?: string; monto: number; saldo: number; estado: string }
interface GastoRow { id: string; fecha: string; categoria?: string; descripcion?: string; monto: number; factura?: string; proveedor?: string }
interface CFRow { id: string; descripcion: string; categoria?: string; monto: number; frecuencia?: string; vence_dia?: number; proveedor?: string; activo?: boolean; notas?: string }

interface FinanzasData {
  // Estado de Resultados (base devengada)
  ingresosBrutos: number; totalCostoCanal: number
  costoPaquetera: number; comisionPaquetera: number; ivaPercibidoLiq: number; comisionLiqPOS: number
  ingresoNeto: number; costoVentas: number; utilidadBruta: number
  gastosOperativos: number; planillaDevengada: number; comisionesDevengadas: number
  cfActivoSum: number; totalEgresosOp: number; utilidadOperativa: number
  margenBruto: string; margenNeto: string
  // Alias compatibilidad
  ingresosMes: number; gastosMesSum: number
  cxcAll: CXCRow[]; cxcAbonos: unknown[]; cxcKpis: { total: number; pendiente: number; nPendiente: number; parcial: number; nParcial: number; vencido: number; nVencido: number; cobradoMes: number }
  cppAll: CPPRow[]; cppPagos: unknown[]; cppKpis: { total: number; pendiente: number; nPendiente: number; parcial: number; nParcial: number; vencido: number; nVencido: number; pagadoMes: number }
  gastosMes: GastoRow[]; mayorGastoMonto: number; mayorGastoCat: string
  costosFijos: CFRow[]
  cobrosProx: number; pagosProx: number; flujoNeto: number
  ppProximos: { total: number; fecha_entrega: string; cliente: string }[]
  cppProximos: { saldo: number; fecha_vence: string; proveedor: string }[]
  ventasPorMes: Record<string, unknown>; gastosPorMes: Record<string, number>
  hoy: string; mesActual: string
}

// ─── Modales simples ──────────────────────────────────────────────────────────
function AbonoModal({ tipo, rowId, saldo, label, onClose, onSaved }: {
  tipo: 'cxc' | 'cpp'; rowId: string; saldo: number; label: string; onClose: () => void; onSaved: () => void
}) {
  const [monto, setMonto] = useState(saldo)
  const [fecha, setFecha] = useState(today())
  const [notas, setNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!monto || monto <= 0) return setError('El monto debe ser mayor a 0')
    if (monto > saldo) return setError(`No puede exceder el saldo pendiente (${fmtUSD(saldo)})`)
    setSaving(true); setError('')
    try {
      const action = tipo === 'cxc' ? 'save_cxc_abono' : 'save_cpp_pago'
      const idField = tipo === 'cxc' ? 'cxc_id' : 'cpp_id'
      const res = await fetch('/api/finanzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, [idField]: rowId, monto, fecha, notas }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 14 }}>{tipo === 'cxc' ? '💰 Registrar Abono' : '💸 Registrar Pago'} — {label}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--surf2)', borderRadius: 'var(--r)', fontSize: 12 }}>
          Saldo pendiente: <strong style={{ color: 'var(--amber)' }}>{fmtUSD(saldo)}</strong>
        </div>
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field"><label>Monto ($)</label><input type="number" min="0.01" step="0.01" max={saldo} value={monto} onChange={e => setMonto(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Notas</label><input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Referencia de transferencia..." /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function GastoModal({ edit, onClose, onSaved }: { edit: GastoRow | null; onClose: () => void; onSaved: () => void }) {
  const CATS_GASTO = ['Insumos', 'Transporte', 'Publicidad', 'Servicios', 'Mantenimiento', 'Personal', 'Oficina', 'Otro']
  const TIPOS_EGRESO = [
    { value: 'operativo',      label: 'Gasto operativo (variable)' },
    { value: 'compra_local',   label: 'Costo de ventas (mercadería)' },
    { value: 'planilla',       label: 'Planilla / honorarios' },
    { value: 'comision_venta', label: 'Comisión a vendedor' },
  ]
  const [fecha,      setFecha]      = useState(edit?.fecha ?? today())
  const [cat,        setCat]        = useState(edit?.categoria ?? 'Otro')
  const [desc,       setDesc]       = useState(edit?.descripcion ?? '')
  const [monto,      setMonto]      = useState(edit?.monto ?? 0)
  const [fact,       setFact]       = useState(edit?.factura ?? 'Sí')
  const [prov,       setProv]       = useState(edit?.proveedor ?? '')
  const [tipoEgreso, setTipoEgreso] = useState((edit as { tipo_egreso?: string } | null)?.tipo_egreso ?? 'operativo')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  async function handleSave() {
    if (!fecha || !monto || monto <= 0) return setError('Fecha y monto son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_gasto', editId: edit?.id, fecha, categoria: cat, descripcion: desc, monto, factura: fact, proveedor: prov, tipo_egreso: tipoEgreso }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Gasto' : '💸 Nuevo Gasto'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field"><label>Fecha <span className="req">*</span></label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          <div className="field"><label>Categoría</label><select value={cat} onChange={e => setCat(e.target.value)}>{CATS_GASTO.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Clasificación Estado de Resultados <span className="req">*</span></label>
            <select value={tipoEgreso} onChange={e => setTipoEgreso(e.target.value)}>
              {TIPOS_EGRESO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 3 }}>
              Define cómo aparece este gasto en el Estado de Resultados
            </div>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Descripción</label><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Detalle del gasto" /></div>
          <div className="field"><label>Monto ($) <span className="req">*</span></label><input type="number" min="0" step="0.01" value={monto || ''} onChange={e => setMonto(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Factura</label><select value={fact} onChange={e => setFact(e.target.value)}><option>Sí</option><option>No (efectivo / informal)</option></select></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Proveedor</label><input value={prov} onChange={e => setProv(e.target.value)} placeholder="Nombre del proveedor" /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

function CostoFijoModal({ edit, onClose, onSaved }: { edit: CFRow | null; onClose: () => void; onSaved: () => void }) {
  const CATS_CF = ['Planilla', 'Alquiler', 'Servicios Básicos', 'Internet', 'Seguros', 'Contabilidad', 'Software', 'Transporte', 'Otro']
  const [concepto, setConcepto] = useState(edit?.descripcion ?? '')
  const [cat,      setCat]      = useState(edit?.categoria ?? 'Otro')
  const [monto,    setMonto]    = useState(edit?.monto ?? 0)
  const [frec,     setFrec]     = useState(edit?.frecuencia ?? 'Mensual')
  const [dia,      setDia]      = useState(edit?.vence_dia ?? 1)
  const [prov,     setProv]     = useState(edit?.proveedor ?? '')
  const [activo,   setActivo]   = useState(edit?.activo !== false)
  const [notas,    setNotas]    = useState(edit?.notas ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleSave() {
    if (!concepto.trim() || !monto || monto <= 0) return setError('Concepto y monto son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_costo_fijo', editId: edit?.id, concepto, categoria: cat, monto, frecuencia: frec, vence_dia: dia, proveedor: prov, activo, notas }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Costo Fijo' : '📌 Nuevo Costo Fijo'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Concepto <span className="req">*</span></label><input value={concepto} onChange={e => setConcepto(e.target.value)} placeholder="Ej. Planilla, Alquiler oficina" /></div>
          <div className="field"><label>Categoría</label><select value={cat} onChange={e => setCat(e.target.value)}>{CATS_CF.map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="field"><label>Monto mensual ($) <span className="req">*</span></label><input type="number" min="0" step="0.01" value={monto || ''} onChange={e => setMonto(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Frecuencia</label><select value={frec} onChange={e => setFrec(e.target.value)}><option>Mensual</option><option>Bimestral</option><option>Trimestral</option><option>Anual</option></select></div>
          <div className="field"><label>Día de vencimiento</label><input type="number" min="1" max="31" value={dia} onChange={e => setDia(parseInt(e.target.value) || 1)} /></div>
          <div className="field"><label>Proveedor / Beneficiario</label><input value={prov} onChange={e => setProv(e.target.value)} placeholder="Nombre" /></div>
          <div className="field"><label>Estado</label><select value={activo ? 'Activo' : 'Inactivo'} onChange={e => setActivo(e.target.value === 'Activo')}><option>Activo</option><option>Inactivo</option></select></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Notas</label><textarea value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones..." rows={2} /></div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Tabla CXC / CPP genérica ──────────────────────────────────────────────────
function CXCTable({ rows, tipo, onAbono }: {
  rows: CXCRow[] | CPPRow[]; tipo: 'cxc' | 'cpp'
  onAbono: (id: string, saldo: number, label: string) => void
}) {
  const hoy = today()
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead><tr>
          <th>#</th>
          <th>{tipo === 'cxc' ? 'Cliente' : 'Proveedor'}</th>
          <th>Emisión</th><th>Vence</th><th>Monto orig.</th><th>Saldo</th><th>Estado</th><th>Acción</th>
        </tr></thead>
        <tbody>
          {(rows as (CXCRow | CPPRow)[]).map(r => {
            const vencido = r.fecha_vence && r.fecha_vence < hoy && r.estado !== 'Pagado'
            const label = tipo === 'cxc' ? (r as CXCRow).cliente : (r as CPPRow).proveedor
            return (
              <tr key={r.id}>
                <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{r.numero ?? '–'}</td>
                <td style={{ fontWeight: 600 }}>{label}</td>
                <td className="mono" style={{ fontSize: 11 }}>{r.fecha_emision}</td>
                <td className="mono" style={{ fontSize: 11, color: vencido ? 'var(--red)' : 'var(--txt)', fontWeight: vencido ? 700 : 400 }}>{r.fecha_vence ?? '–'}</td>
                <td className="mono" style={{ fontSize: 11 }}>{fmtUSD(r.monto)}</td>
                <td className="mono" style={{ fontWeight: 800, color: r.saldo <= 0 ? 'var(--green)' : 'var(--amber)' }}>{fmtUSD(r.saldo)}</td>
                <td>
                  <span className={`badge ${r.estado === 'Pagado' ? 'badge-green' : vencido ? 'badge-red' : r.estado === 'Parcial' ? 'badge-purple' : 'badge-amber'}`}>
                    {vencido && r.estado !== 'Pagado' ? 'Vencido' : r.estado}
                  </span>
                </td>
                <td>
                  {r.estado !== 'Pagado' && (
                    <button className="btn btn-primary btn-sm" style={{ fontSize: 10, background: 'var(--green)', borderColor: 'var(--green)' }}
                      onClick={() => onAbono(r.id, r.saldo, label)}>
                      {tipo === 'cxc' ? '💰 Abonar' : '💸 Pagar'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin registros</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ─── MÓDULO PRINCIPAL ─────────────────────────────────────────────────────────
export default function FinanzasModule(initialData: FinanzasData) {
  type FinTab = 'balance' | 'cxc' | 'cpp' | 'gastos' | 'costos' | 'indicadores' | 'flujo' | 'presupuesto' | 'conciliacion'
  const [tab, setTab] = useState<FinTab>('balance')
  const [data, setData] = useState<FinanzasData>(initialData)
  const [mesSel, setMesSel] = useState(initialData.mesActual)
  const [cargandoMes, setCargandoMes] = useState(false)
  const [abonoCtx, setAbonoCtx] = useState<{ tipo: 'cxc' | 'cpp'; id: string; saldo: number; label: string } | null>(null)
  const [showGasto, setShowGasto] = useState(false)
  const [editGasto, setEditGasto] = useState<GastoRow | null>(null)
  const [showCF, setShowCF] = useState(false)
  const [editCF, setEditCF] = useState<CFRow | null>(null)

  const reload = () => window.location.reload()

  async function cargarMes(mes: string) {
    setCargandoMes(true)
    try {
      const res = await fetch(`/api/finanzas?mes=${mes}`)
      const json = await res.json()
      if (json.ok) setData(json.data as FinanzasData)
    } catch { /* silencioso */ }
    finally { setCargandoMes(false) }
  }

  const tabs: { key: FinTab; label: string }[] = [
    { key: 'balance',     label: '📊 Balance'      },
    { key: 'cxc',         label: '💰 CxC'          },
    { key: 'cpp',         label: '💸 CPP'          },
    { key: 'gastos',      label: '📋 Gastos'       },
    { key: 'costos',      label: '📌 Costos Fijos' },
    { key: 'indicadores', label: '📈 Indicadores'  },
    { key: 'flujo',       label: '💧 Flujo Caja'   },
    { key: 'presupuesto',   label: '🎯 Presupuesto'    },
    { key: 'conciliacion', label: '🏦 Conciliación'  },
  ]

  return (
    <div style={{ padding: 20 }}>
      {/* Tab bar */}
      <div className="tab-bar" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.key} className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── BALANCE — ESTADO DE RESULTADOS COMPLETO (BASE DEVENGADA) ── */}
      {tab === 'balance' && (
        <div>
          {/* Selector de mes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div className="field" style={{ flex: '0 0 160px' }}>
              <label>Período</label>
              <input type="month" value={mesSel}
                onChange={e => { setMesSel(e.target.value); cargarMes(e.target.value) }}
              />
            </div>
            {cargandoMes && (
              <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="spinner" style={{ width: 14, height: 14 }} />
                Cargando {mesSel}...
              </div>
            )}
            {!cargandoMes && mesSel !== initialData.mesActual && (
              <div style={{ fontSize: 11, color: 'var(--indigo)', marginTop: 18 }}>
                📅 {new Date(mesSel + '-02').toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })}
                {' · '}
                <button onClick={() => { setMesSel(initialData.mesActual); cargarMes(initialData.mesActual) }}
                  style={{ background: 'none', border: 'none', color: 'var(--indigo)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>
                  Mes actual
                </button>
              </div>
            )}
          </div>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Ingresos Brutos',    value: fmtUSD(data.ingresosBrutos),    color: 'var(--green)'  },
              { label: 'Costos de Canal',     value: fmtUSD(data.totalCostoCanal),   color: 'var(--amber)'  },
              { label: 'Ingreso Neto',        value: fmtUSD(data.ingresoNeto),       color: 'var(--teal)'   },
              { label: 'Utilidad Bruta',      value: fmtUSD(data.utilidadBruta),     color: 'var(--blue)',  sub: `Margen: ${data.margenBruto}` },
              { label: 'Utilidad Operativa',  value: fmtUSD(data.utilidadOperativa), color: data.utilidadOperativa >= 0 ? 'var(--green)' : 'var(--red)', sub: `Margen: ${data.margenNeto}` },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>

          {/* Estado de Resultados completo */}
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>📄 Estado de Resultados — {monthLabel(data.mesActual)}</div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 14, fontStyle: 'italic' }}>Base devengada · NIIF para PYMES Sección 2</div>
            {[
              // INGRESOS
              { label: 'INGRESOS', monto: null, tipo: 'seccion' },
              { label: 'Ingresos brutos de ventas (devengados)', monto: data.ingresosBrutos, tipo: 'ingreso' },
              { label: '(−) Costo paquetera (envío)', monto: -data.costoPaquetera, tipo: 'deduccion', cond: data.costoPaquetera > 0 },
              { label: '(−) Comisión paquetera', monto: -data.comisionPaquetera, tipo: 'deduccion', cond: data.comisionPaquetera > 0 },
              { label: '(−) IVA percibido Link de Pago / POS', monto: -data.ivaPercibidoLiq, tipo: 'deduccion', cond: data.ivaPercibidoLiq > 0 },
              { label: '(−) Comisión + IVA Link de Pago / POS', monto: -data.comisionLiqPOS, tipo: 'deduccion', cond: data.comisionLiqPOS > 0 },
              { label: '= Ingreso Neto', monto: data.ingresoNeto, tipo: 'subtotal' },
              // COSTO DE VENTAS
              { label: 'COSTO DE VENTAS', monto: null, tipo: 'seccion' },
              { label: '(−) Costo de mercadería vendida (compras locales)', monto: -data.costoVentas, tipo: 'deduccion' },
              { label: '= UTILIDAD BRUTA', monto: data.utilidadBruta, tipo: 'subtotal' },
              // GASTOS OPERATIVOS
              { label: 'GASTOS OPERATIVOS', monto: null, tipo: 'seccion' },
              { label: '(−) Gastos variables operativos', monto: -data.gastosOperativos, tipo: 'deduccion', cond: data.gastosOperativos > 0 },
              { label: '(−) Planilla y honorarios (devengado)', monto: -data.planillaDevengada, tipo: 'deduccion', cond: data.planillaDevengada > 0 },
              { label: '(−) Comisiones a vendedores (devengado)', monto: -data.comisionesDevengadas, tipo: 'deduccion', cond: data.comisionesDevengadas > 0 },
              { label: '(−) Costos fijos (devengado)', monto: -data.cfActivoSum, tipo: 'deduccion' },
              { label: '= UTILIDAD OPERATIVA', monto: data.utilidadOperativa, tipo: 'resultado' },
            ].filter(r => r.cond !== false).map(r => {
              if (r.tipo === 'seccion') return (
                <div key={r.label} style={{ padding: '10px 0 4px', fontSize: 10, fontWeight: 800, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.6px', borderTop: '1px solid var(--bdr)', marginTop: 4 }}>
                  {r.label}
                </div>
              )
              return (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0 7px ' + (r.tipo === 'subtotal' || r.tipo === 'resultado' ? '0' : '16px'), borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: r.tipo === 'resultado' ? 14 : 12 }}>
                  <span style={{ fontWeight: r.tipo === 'resultado' || r.tipo === 'subtotal' ? 700 : 400, color: r.tipo === 'resultado' || r.tipo === 'subtotal' ? 'var(--txt)' : 'var(--txt2)' }}>{r.label}</span>
                  <span className="mono" style={{ fontWeight: r.tipo === 'resultado' || r.tipo === 'subtotal' ? 800 : 600, color: r.tipo === 'ingreso' || r.tipo === 'subtotal' ? 'var(--green)' : r.tipo === 'deduccion' ? 'var(--red)' : r.monto! >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                    {r.monto !== null ? fmtUSD(Math.abs(r.monto!)) : ''}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Posición de cartera */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>📥 Activo Corriente — CxC</div>
              {[
                { label: 'Pendiente de cobro',  v: data.cxcKpis.pendiente },
                { label: 'Cobro parcial',        v: data.cxcKpis.parcial   },
                { label: 'Vencido sin cobrar',   v: data.cxcKpis.vencido   },
                { label: 'Total cartera',        v: data.cxcKpis.total,    bold: true },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--bdr)' }}>
                  <span style={{ color: 'var(--txt2)', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
                  <span className="mono" style={{ fontWeight: r.bold ? 800 : 600, color: 'var(--green)' }}>{fmtUSD(r.v)}</span>
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', marginBottom: 10 }}>📤 Pasivo Corriente — CPP</div>
              {[
                { label: 'Pendiente de pago',   v: data.cppKpis.pendiente },
                { label: 'Pago parcial',         v: data.cppKpis.parcial   },
                { label: 'Vencido sin pagar',    v: data.cppKpis.vencido   },
                { label: 'Total obligaciones',   v: data.cppKpis.total,    bold: true },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', borderBottom: '1px solid var(--bdr)' }}>
                  <span style={{ color: 'var(--txt2)', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
                  <span className="mono" style={{ fontWeight: r.bold ? 800 : 600, color: 'var(--red)' }}>{fmtUSD(r.v)}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, padding: '8px 0', borderTop: '2px solid var(--bdr)', display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800 }}>
                <span>Posición neta (CxC − CPP)</span>
                <span className="mono" style={{ color: (data.cxcKpis.total - data.cppKpis.total) >= 0 ? 'var(--teal)' : 'var(--red)' }}>
                  {fmtUSD(data.cxcKpis.total - data.cppKpis.total)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CXC ── */}
      {tab === 'cxc' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total por Cobrar', value: fmtUSD(data.cxcKpis.total),      color: 'var(--red)'   },
              { label: 'Pendiente',        value: fmtUSD(data.cxcKpis.pendiente),   color: 'var(--amber)', sub: `${data.cxcKpis.nPendiente} facturas` },
              { label: 'Parcial',          value: fmtUSD(data.cxcKpis.parcial),     color: 'var(--blue)',  sub: `${data.cxcKpis.nParcial} facturas` },
              { label: 'Vencidas',         value: fmtUSD(data.cxcKpis.vencido),     color: 'var(--red)',   sub: `${data.cxcKpis.nVencido} facturas` },
              { label: 'Cobrado este Mes', value: fmtUSD(data.cxcKpis.cobradoMes),  color: 'var(--green)' },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card">
            <CXCTable rows={data.cxcAll} tipo="cxc" onAbono={(id, saldo, label) => setAbonoCtx({ tipo: 'cxc', id, saldo, label })} />
          </div>
        </div>
      )}

      {/* ── CPP ── */}
      {tab === 'cpp' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total por Pagar', value: fmtUSD(data.cppKpis.total),     color: 'var(--red)'   },
              { label: 'Pendiente',       value: fmtUSD(data.cppKpis.pendiente),  color: 'var(--amber)', sub: `${data.cppKpis.nPendiente} facturas` },
              { label: 'Parcial',         value: fmtUSD(data.cppKpis.parcial),    color: 'var(--blue)',  sub: `${data.cppKpis.nParcial} facturas` },
              { label: 'Vencidas',        value: fmtUSD(data.cppKpis.vencido),    color: 'var(--red)',   sub: `${data.cppKpis.nVencido} facturas` },
              { label: 'Pagado este Mes', value: fmtUSD(data.cppKpis.pagadoMes),  color: 'var(--green)' },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card">
            <CXCTable rows={data.cppAll} tipo="cpp" onAbono={(id, saldo, label) => setAbonoCtx({ tipo: 'cpp', id, saldo, label })} />
          </div>
        </div>
      )}

      {/* ── GASTOS ── */}
      {tab === 'gastos' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Gastos del Mes',     value: fmtUSD(data.gastosMesSum),    color: 'var(--red)'   },
              { label: 'Margen Operativo',   value: data.ingresosMes > 0 ? ((data.ingresosMes - data.gastosMesSum) / data.ingresosMes * 100).toFixed(1) + '%' : '0%', color: 'var(--teal)' },
              { label: 'Mayor Gasto',        value: fmtUSD(data.mayorGastoMonto), color: 'var(--amber)', sub: data.mayorGastoCat },
              { label: 'vs Costos Fijos',    value: data.cfActivoSum > 0 ? (data.gastosMesSum / data.cfActivoSum * 100).toFixed(0) + '%' : '–', color: 'var(--green)' },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 18 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>📋 Registro de Gastos</h3>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditGasto(null); setShowGasto(true) }}>+ Nuevo Gasto</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Monto</th><th>Factura</th><th>Proveedor</th><th>Acción</th></tr></thead>
                <tbody>
                  {data.gastosMes.map(g => (
                    <tr key={g.id}>
                      <td className="mono" style={{ fontSize: 11 }}>{g.fecha}</td>
                      <td><span className="badge badge-gray">{g.categoria ?? '–'}</span></td>
                      <td style={{ fontSize: 12 }}>{g.descripcion ?? '–'}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(g.monto)}</td>
                      <td style={{ fontSize: 11 }}>{g.factura ?? '–'}</td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{g.proveedor ?? '–'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditGasto(g); setShowGasto(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={async () => {
                            if (!confirm('¿Eliminar este gasto?')) return
                            await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_gasto', id: g.id }) })
                            reload()
                          }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.gastosMes.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin gastos este mes</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── COSTOS FIJOS ── */}
      {tab === 'costos' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total Costos Fijos/mes', value: fmtUSD(data.cfActivoSum), color: 'var(--red)',    sub: `${data.costosFijos.filter(c => c.activo !== false).length} ítems activos` },
              { label: 'Mayor Costo',            value: fmtUSD(data.costosFijos[0]?.monto ?? 0), color: 'var(--amber)', sub: data.costosFijos[0]?.descripcion ?? '–' },
              { label: 'Categorías Activas',     value: String(new Set(data.costosFijos.filter(c => c.activo !== false).map(c => c.categoria)).size), color: 'var(--blue)' },
              { label: 'Proyección Anual',       value: fmtUSD(data.cfActivoSum * 12), color: 'var(--purple)' },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>📋 Registro de Costos Fijos</h3>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditCF(null); setShowCF(true) }}>+ Nuevo Costo</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Concepto</th><th>Categoría</th><th>Monto/mes</th><th>Frecuencia</th><th>Proveedor</th><th>Vence día</th><th>Estado</th><th>Acción</th></tr></thead>
                <tbody>
                  {data.costosFijos.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.descripcion}</td>
                      <td><span className="badge badge-gray">{c.categoria ?? '–'}</span></td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(c.monto)}</td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.frecuencia ?? 'Mensual'}</td>
                      <td style={{ fontSize: 11 }}>{c.proveedor ?? '–'}</td>
                      <td className="mono" style={{ textAlign: 'center', fontSize: 11 }}>{c.vence_dia ?? '–'}</td>
                      <td><span className={`badge ${c.activo !== false ? 'badge-green' : 'badge-gray'}`}>{c.activo !== false ? 'Activo' : 'Inactivo'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditCF(c); setShowCF(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={async () => {
                            if (!confirm('¿Eliminar este costo fijo?')) return
                            await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_costo_fijo', id: c.id }) })
                            reload()
                          }}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.costosFijos.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin costos fijos registrados</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── INDICADORES ── */}
      {tab === 'indicadores' && (() => {
        // Punto de Equilibrio = Costos Fijos / (1 - CostoVariable/Ingreso)
        // Margen de contribución = (IngresoNeto - CostoVentas - GastosOperativos) / IngresoNeto
        const totalCostoVar    = data.costoVentas + data.gastosOperativos
        const margenContrib    = data.ingresoNeto > 0 ? (data.ingresoNeto - totalCostoVar) / data.ingresoNeto : 0
        const puntoEquilibrio  = margenContrib > 0
          ? (data.cfActivoSum + data.planillaDevengada + data.comisionesDevengadas) / margenContrib
          : 0
        const diasCobro        = data.ingresosBrutos > 0
          ? Math.round(data.cxcKpis.total / (data.ingresosBrutos / 30))
          : 0

        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {[
              {
                label: 'Margen Bruto',
                value: data.ingresoNeto > 0 ? (data.utilidadBruta / data.ingresoNeto * 100).toFixed(1) + '%' : '–',
                desc: 'Utilidad Bruta / Ingreso Neto — excluye gastos operativos, planilla y fijos',
                color: 'var(--teal)'
              },
              {
                label: 'Margen Operativo (Neto)',
                value: data.margenNeto,
                desc: 'Utilidad Operativa / Ingreso Neto — incluye todos los egresos del período',
                color: data.utilidadOperativa >= 0 ? 'var(--green)' : 'var(--red)'
              },
              {
                label: 'Índice CxC / Ventas',
                value: data.ingresosBrutos > 0 ? (data.cxcKpis.total / data.ingresosBrutos * 100).toFixed(1) + '%' : '–',
                desc: 'Cartera pendiente de cobro vs ingresos brutos del mes',
                color: 'var(--amber)'
              },
              {
                label: 'Días Promedio de Cobro',
                value: diasCobro > 0 ? diasCobro + ' días' : '–',
                desc: 'CxC total / (Ventas brutas ÷ 30) — cuántos días tarda en cobrar',
                color: 'var(--amber)'
              },
              {
                label: 'Ratio CPP / CxC',
                value: data.cxcKpis.total > 0 ? (data.cppKpis.total / data.cxcKpis.total).toFixed(2) : '–',
                desc: 'Obligaciones con proveedores / cartera por cobrar. < 1 es saludable',
                color: data.cppKpis.total <= data.cxcKpis.total ? 'var(--green)' : 'var(--red)'
              },
              {
                label: 'Punto de Equilibrio',
                value: puntoEquilibrio > 0 ? fmtUSD(puntoEquilibrio) : '–',
                desc: 'Ventas mínimas para cubrir todos los costos fijos y variables estructurales',
                color: 'var(--blue)'
              },
              {
                label: 'Cobertura CF vs Ingreso Neto',
                value: data.cfActivoSum > 0 ? (data.ingresoNeto / (data.cfActivoSum + data.planillaDevengada + data.comisionesDevengadas)).toFixed(1) + 'x' : '–',
                desc: 'Cuántas veces cubre el ingreso neto los costos fijos estructurales',
                color: 'var(--purple)'
              },
              {
                label: 'Margen de Contribución',
                value: (margenContrib * 100).toFixed(1) + '%',
                desc: 'Porcentaje del ingreso que cubre los costos fijos después de cubrir variables',
                color: margenContrib > 0.3 ? 'var(--green)' : margenContrib > 0.15 ? 'var(--amber)' : 'var(--red)'
              },
            ].map(k => (
              <div key={k.label} className="card" style={{ borderLeft: `3px solid ${k.color}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.color, fontFamily: 'var(--font-mono)' }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 6, lineHeight: 1.5 }}>{k.desc}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── FLUJO DE CAJA ── */}
      {tab === 'flujo' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Cobros Proyectados 30d',  value: fmtUSD(data.cobrosProx),  color: 'var(--green)', sub: 'PP que vencen próximos 30 días' },
              { label: 'Pagos Proyectados 30d',   value: fmtUSD(data.pagosProx),   color: 'var(--red)',   sub: 'CPP que vencen próximos 30 días' },
              { label: 'Posición Neta de Caja',   value: fmtUSD(data.flujoNeto),   color: data.flujoNeto >= 0 ? 'var(--teal)' : 'var(--red)', sub: 'cobros − pagos proyectados' },
              { label: 'Alertas',                 value: String(data.ppProximos.length + data.cppProximos.length), color: 'var(--amber)', sub: 'vencimientos próximos 30d' },
            ].map(k => (
              <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                <div className="kpi-label">{k.label}</div>
                <div className="kpi-value" style={{ color: k.color, fontSize: 18 }}>{k.value}</div>
                {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--green)' }}>💰 PP por cobrar — próximos 30 días</div>
              {data.ppProximos.length === 0 ? <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Sin pendientes próximos</div> :
                data.ppProximos.map((pp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--bdr)', fontSize: 12 }}>
                    <span>{pp.cliente} <span style={{ fontSize: 10, color: 'var(--txt3)' }}>({pp.fecha_entrega})</span></span>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtUSD(pp.total)}</span>
                  </div>
                ))}
            </div>
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--red)' }}>💸 CPP por pagar — próximos 30 días</div>
              {data.cppProximos.length === 0 ? <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Sin pagos próximos</div> :
                data.cppProximos.map((cpp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--bdr)', fontSize: 12 }}>
                    <span>{cpp.proveedor} <span style={{ fontSize: 10, color: 'var(--txt3)' }}>({cpp.fecha_vence})</span></span>
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(cpp.saldo)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PRESUPUESTO ── */}
      {tab === 'presupuesto' && (
        <div>
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>🎯 Estado de Presupuesto — {monthLabel(data.mesActual)}</div>
            <table className="tbl">
              <thead><tr><th>Concepto</th><th>Presupuestado</th><th>Real</th><th>Diferencia</th><th>%</th></tr></thead>
              <tbody>
                {[
                  { concepto: 'Ingresos (ventas)', presupuesto: data.cfActivoSum * 3, real: data.ingresosMes },
                  { concepto: 'Gastos variables',  presupuesto: data.cfActivoSum * 0.5, real: data.gastosMesSum },
                  { concepto: 'Costos fijos',      presupuesto: data.cfActivoSum, real: data.cfActivoSum },
                  { concepto: 'Utilidad neta',     presupuesto: data.cfActivoSum * 1.5, real: data.ingresosMes - data.gastosMesSum - data.cfActivoSum },
                ].map(r => {
                  const diff = r.real - r.presupuesto
                  const pct  = r.presupuesto > 0 ? (r.real / r.presupuesto * 100).toFixed(0) + '%' : '–'
                  return (
                    <tr key={r.concepto}>
                      <td style={{ fontWeight: 600 }}>{r.concepto}</td>
                      <td className="mono">{fmtUSD(r.presupuesto)}</td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(r.real)}</td>
                      <td className="mono" style={{ color: diff >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{diff >= 0 ? '+' : ''}{fmtUSD(diff)}</td>
                      <td className="mono" style={{ color: diff >= 0 ? 'var(--green)' : 'var(--red)' }}>{pct}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>
              * Presupuesto estimado automáticamente basado en costos fijos. Puedes personalizarlo en una próxima versión.
            </div>
          </div>
        </div>
      )}

      {/* Modales */}
      {abonoCtx && (
        <AbonoModal tipo={abonoCtx.tipo} rowId={abonoCtx.id} saldo={abonoCtx.saldo} label={abonoCtx.label}
          onClose={() => setAbonoCtx(null)} onSaved={() => { setAbonoCtx(null); reload() }} />
      )}
      {showGasto && <GastoModal edit={editGasto} onClose={() => { setShowGasto(false); setEditGasto(null) }} onSaved={() => { setShowGasto(false); setEditGasto(null); reload() }} />}
      {showCF    && <CostoFijoModal edit={editCF} onClose={() => { setShowCF(false); setEditCF(null) }} onSaved={() => { setShowCF(false); setEditCF(null); reload() }} />}
      {tab === 'conciliacion' && (
        <ConciliacionTab />
      )}

    </div>
  )
}

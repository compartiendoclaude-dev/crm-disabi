'use client'
import ConciliacionTab from './ConciliacionTab'
import { useState, useEffect } from 'react'
import { fmtUSD, today, monthLabel, estaVencida } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface CXCRow { id: string; cliente: string; fecha_venta?: string; fecha_vence?: string; monto_total: number; monto_pendiente: number; estado: string; notas?: string }
interface CPPRow { id: string; numero_doc?: string; proveedor: string; fecha_emision?: string; fecha_vence?: string; monto_total: number; monto_pendiente: number; estado: string; descripcion?: string; notas?: string; categoria_gasto?: string }
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
  cppProximos: { monto_pendiente: number; fecha_vence: string; proveedor: string }[]
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
    { value: 'compra_local',   label: 'Compra local (gasto operativo)' },
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
function CXCTable({ rows, tipo, onAbono, onEdit, onDelete }: {
  rows: CXCRow[] | CPPRow[]; tipo: 'cxc' | 'cpp'
  onAbono: (id: string, saldo: number, label: string) => void
  onEdit?: (row: CXCRow | CPPRow) => void
  onDelete?: (id: string) => void
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
            const vencido = estaVencida(r, hoy)
            const label = tipo === 'cxc' ? (r as CXCRow).cliente : (r as CPPRow).proveedor
            const montoOrig = tipo === 'cxc' ? (r as CXCRow).monto_total : (r as CPPRow).monto_total
            const saldoActual = tipo === 'cxc' ? (r as CXCRow).monto_pendiente : (r as CPPRow).monto_pendiente
            const fechaMov = tipo === 'cxc' ? (r as CXCRow).fecha_venta : (r as CPPRow).fecha_emision
            const numRef = tipo === 'cpp' ? (r as CPPRow).numero_doc : undefined
            return (
              <tr key={r.id}>
                <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{numRef ?? '–'}</td>
                <td style={{ fontWeight: 600 }}>{label}</td>
                <td className="mono" style={{ fontSize: 11 }}>{fechaMov ?? '–'}</td>
                <td className="mono" style={{ fontSize: 11, color: vencido ? 'var(--red)' : 'var(--txt)', fontWeight: vencido ? 700 : 400 }}>{r.fecha_vence ?? '–'}</td>
                <td className="mono" style={{ fontSize: 11 }}>{fmtUSD(montoOrig)}</td>
                <td className="mono" style={{ fontWeight: 800, color: saldoActual <= 0 ? 'var(--green)' : 'var(--amber)' }}>{fmtUSD(saldoActual)}</td>
                <td>
                  <span className={`badge ${r.estado === 'Pagado' ? 'badge-green' : vencido ? 'badge-red' : r.estado === 'Parcial' ? 'badge-purple' : 'badge-amber'}`}>
                    {vencido && r.estado !== 'Pagado' ? 'Vencido' : r.estado}
                  </span>
                </td>
                <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {r.estado !== 'Pagado' && (
                    <button className="btn btn-primary btn-sm" style={{ fontSize: 10, background: 'var(--green)', borderColor: 'var(--green)' }}
                      onClick={() => onAbono(r.id, saldoActual, label)}>
                      {tipo === 'cxc' ? '💰 Abonar' : '💸 Pagar'}
                    </button>
                  )}
                  {onEdit && (
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }} onClick={() => onEdit(r)}>✏️</button>
                  )}
                  {onDelete && (
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, color: 'var(--red)' }}
                      onClick={() => { if (confirm('¿Eliminar este registro?')) onDelete(r.id) }}>🗑</button>
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

// ─── Modal crear/editar CxC o CPP ─────────────────────────────────────────────
const CATS_CPP_GASTO = [
  { value: 'alquiler',   label: 'Alquiler' },
  { value: 'sueldos',    label: 'Sueldos / Honorarios' },
  { value: 'compras',    label: 'Compras / Suministros' },
  { value: 'comisiones', label: 'Comisiones' },
  { value: 'otro',       label: 'Otro gasto operativo' },
]

function CxcCppFormModal({ tipo, edit, onClose, onSaved }: {
  tipo: 'cxc' | 'cpp'
  edit: { id?: string; nombre: string; monto: number; fecha_emision?: string; fecha_vence?: string; notas?: string; estado?: string; categoria_gasto?: string } | null
  onClose: () => void
  onSaved: () => void
}) {
  const [nombre,        setNombre]        = useState(edit?.nombre ?? '')
  const [monto,         setMonto]         = useState(edit?.monto ?? 0)
  const [fechaEm,       setFechaEm]       = useState(edit?.fecha_emision ?? today())
  const [fechaVence,    setFechaVence]    = useState(edit?.fecha_vence ?? '')
  const [yaPagada,      setYaPagada]      = useState(edit?.estado === 'Pagado')
  const [notas,         setNotas]         = useState(edit?.notas ?? '')
  const [referencia,    setReferencia]    = useState('')
  const [categoriaGasto, setCategoriaGasto] = useState(edit?.categoria_gasto ?? 'otro')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  const esCxc = tipo === 'cxc'
  const label = esCxc ? 'cliente' : 'proveedor'

  async function handleSave() {
    if (!nombre.trim() || !monto || monto <= 0)
      return setError(`${esCxc ? 'Cliente' : 'Proveedor'} y monto son requeridos`)
    setSaving(true); setError('')
    try {
      const body: Record<string, unknown> = {
        action: esCxc ? 'save_cxc' : 'save_cpp',
        editId: edit?.id,
        [label]: nombre.trim(),
        monto, fecha_emision: fechaEm,
        fecha_vence: fechaVence || null,
        estado: yaPagada ? 'Pagado' : 'Pendiente',
        notas: notas || null,
        referencia: referencia || null,
        ...(esCxc ? {} : { categoria_gasto: categoriaGasto }),
      }
      const res = await fetch('/api/finanzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 14 }}>
            {edit ? '✏️ Editar' : '➕ Nueva'} {esCxc ? 'Cuenta por Cobrar' : 'Cuenta por Pagar'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>{esCxc ? 'Cliente' : 'Proveedor'} <span className="req">*</span></label>
            <input value={nombre} onChange={e => setNombre(e.target.value)}
              placeholder={esCxc ? 'Nombre del cliente' : 'Nombre del proveedor'} />
          </div>
          <div className="field">
            <label>Monto ($) <span className="req">*</span></label>
            <input type="number" min="0.01" step="0.01" value={monto || ''}
              onChange={e => setMonto(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Fecha de emisión</label>
            <input type="date" value={fechaEm} onChange={e => setFechaEm(e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha de {esCxc ? 'cobro/vencimiento' : 'pago/vencimiento'}</label>
            <input type="date" value={fechaVence} onChange={e => setFechaVence(e.target.value)} />
          </div>
          <div className="field">
            <label>Referencia / N° factura</label>
            <input value={referencia} onChange={e => setReferencia(e.target.value)}
              placeholder="CCF-001, Factura #..." />
          </div>
          {!esCxc && (
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label>Clasificación del gasto</label>
              <select value={categoriaGasto} onChange={e => setCategoriaGasto(e.target.value)}>
                {CATS_CPP_GASTO.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 3 }}>
                Define contra qué cuenta se registra este gasto en el libro contable
              </div>
            </div>
          )}
          <div className="field" style={{ gridColumn: 'span 2', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={yaPagada} onChange={e => setYaPagada(e.target.checked)} style={{ width: 16, height: 16 }} />
            <label style={{ marginBottom: 0 }}>Ya fue {esCxc ? 'cobrada' : 'pagada'} (carga histórica)</label>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notas</label>
            <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Descripción, condiciones..." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳...' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MÓDULO PRINCIPAL ─────────────────────────────────────────────────────────
export default function FinanzasModule(initialData: FinanzasData) {
  type FinTab = 'balance' | 'cxc' | 'cpp' | 'gastos' | 'costos' | 'indicadores' | 'flujo' | 'presupuesto' | 'conciliacion' | 'apertura'
  const [tab, setTab] = useState<FinTab>('balance')
  const [data, setData] = useState<FinanzasData>(initialData)
  const [mesSel, setMesSel] = useState(initialData.mesActual)
  const [cargandoMes, setCargandoMes] = useState(false)
  const [abonoCtx, setAbonoCtx] = useState<{ tipo: 'cxc' | 'cpp'; id: string; saldo: number; label: string } | null>(null)
  const [showCxcModal, setShowCxcModal] = useState(false)
  const [showCppModal, setShowCppModal] = useState(false)
  const [editCxc, setEditCxc] = useState<{ id: string; cliente: string; monto: number; saldo: number; fecha_emision: string; fecha_vence?: string; notas?: string; estado?: string } | null>(null)
  const [editCpp, setEditCpp] = useState<{ id: string; proveedor: string; monto_total: number; monto_pendiente: number; fecha_emision?: string; fecha_vence?: string; notas?: string; estado?: string; categoria_gasto?: string } | null>(null)
  const [filtroMesCxc, setFiltroMesCxc] = useState('todos')
  const [filtroMesCpp, setFiltroMesCpp] = useState('todos')

  // ── Cierre mensual ──────────────────────────────────────────────────────────
  const [cierres, setCierres] = useState<{ periodo: string; cerrado_en: string; notas?: string | null }[]>([])
  const [cargandoCierre, setCargandoCierre] = useState(false)
  const [notasCierre, setNotasCierre] = useState('')
  const [errorCierre, setErrorCierre] = useState('')

  async function cargarCierres() {
    try {
      const res = await fetch('/api/cierre')
      const json = await res.json()
      if (json.ok) setCierres(json.cierres ?? [])
    } catch { /* silencioso */ }
  }
  useEffect(() => { cargarCierres() }, [])

  const cierreDelMes = cierres.find(c => c.periodo === mesSel)

  async function cerrarMes() {
    setCargandoCierre(true); setErrorCierre('')
    try {
      const res = await fetch('/api/cierre', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cerrar_mes', periodo: mesSel, notas: notasCierre || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNotasCierre('')
      await cargarCierres()
    } catch (e: unknown) { setErrorCierre(e instanceof Error ? e.message : 'Error') }
    finally { setCargandoCierre(false) }
  }

  async function reabrirMes() {
    if (!confirm(`¿Reabrir ${mesSel}? Se podrán volver a crear/editar movimientos con fecha de ese mes.`)) return
    setCargandoCierre(true); setErrorCierre('')
    try {
      const res = await fetch('/api/cierre', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reabrir_mes', periodo: mesSel }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await cargarCierres()
    } catch (e: unknown) { setErrorCierre(e instanceof Error ? e.message : 'Error') }
    finally { setCargandoCierre(false) }
  }

  // ── Contabilidad: devengo mensual de Costos Fijos ────────────────────────────
  const [cargandoDevengoCF, setCargandoDevengoCF] = useState(false)
  async function generarDevengoCF() {
    setCargandoDevengoCF(true)
    try {
      const res = await fetch('/api/finanzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generar_devengo_costos_fijos', periodo: mesSel }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      alert(`Se contabilizaron ${json.generados} costo(s) fijo(s) de ${mesSel}.`)
    } catch (e: unknown) { alert(e instanceof Error ? e.message : 'Error al generar el devengo') }
    finally { setCargandoDevengoCF(false) }
  }

  // Extrae los meses disponibles (YYYY-MM) a partir de fecha_emision, más recientes primero
  function mesesDisponibles<T>(rows: T[], campo: keyof T): string[] {
    const set = new Set<string>()
    rows.forEach(r => { const v = r[campo] as unknown as string; if (v) set.add(v.slice(0, 7)) })
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  }

  function filtrarPorMes<T>(rows: T[], filtro: string, campo: keyof T): T[] {
    if (filtro === 'todos') return rows
    return rows.filter(r => (r[campo] as unknown as string)?.startsWith(filtro))
  }

  function labelMes(ym: string): string {
    if (ym === 'todos') return 'Todos los meses'
    const [a, m] = ym.split('-')
    return new Date(parseInt(a), parseInt(m) - 1, 1).toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })
  }
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
    { key: 'apertura',     label: '🔑 Apertura'       },
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

          {/* Cierre mensual — bloquea/desbloquea movimientos del mes seleccionado */}
          <div className="card" style={{ marginBottom: 16, padding: 14, borderLeft: `3px solid ${cierreDelMes ? 'var(--red)' : 'var(--green)'}` }}>
            {errorCierre && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{errorCierre}</div>}
            {cierreDelMes ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12 }}>
                  🔒 <strong>{monthLabel(mesSel)} está cerrado contablemente</strong>
                  {' '}— no se pueden crear ni editar movimientos con fecha de este mes.
                  {cierreDelMes.notas && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>Nota: {cierreDelMes.notas}</div>}
                </div>
                <button className="btn btn-secondary" onClick={reabrirMes} disabled={cargandoCierre} style={{ marginLeft: 'auto' }}>
                  {cargandoCierre ? '⏳...' : '🔓 Reabrir mes'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, flex: '1 1 260px' }}>
                  🔓 <strong>{monthLabel(mesSel)} está abierto</strong> — se pueden crear y editar movimientos de este mes.
                  Ciérralo cuando ya reportaste el Estado de Resultados de este período, para que nadie lo cambie después sin darse cuenta.
                </div>
                <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
                  <label>Nota de cierre (opcional)</label>
                  <input value={notasCierre} onChange={e => setNotasCierre(e.target.value)} placeholder="Ej. cerrado tras revisión con contador" />
                </div>
                <button className="btn btn-primary" onClick={cerrarMes} disabled={cargandoCierre}>
                  {cargandoCierre ? '⏳...' : `🔒 Cerrar ${mesSel}`}
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
              { label: '(−) Costo de mercadería vendida (importaciones recibidas: costo + flete + impuestos)', monto: -data.costoVentas, tipo: 'deduccion' },
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
      {tab === 'cxc' && (() => {
        const cxcFiltrado = filtrarPorMes(data.cxcAll, filtroMesCxc, 'fecha_venta')
        const kTotal     = cxcFiltrado.reduce((a, x) => a + x.monto_pendiente, 0)
        // 'Vencido' nunca se escribe en `estado` — se deriva por fecha (estaVencida),
        // y Pendiente/Parcial excluyen lo ya vencido para que los baldes no se traslapen.
        const kVenc      = cxcFiltrado.filter(x => estaVencida(x))
        const kPend      = cxcFiltrado.filter(x => x.estado === 'Pendiente' && !estaVencida(x))
        const kParc      = cxcFiltrado.filter(x => x.estado === 'Parcial' && !estaVencida(x))
        const kCobrado   = cxcFiltrado.filter(x => x.estado === 'Pagado').reduce((a, x) => a + x.monto_total, 0)

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="field" style={{ flex: '0 0 200px' }}>
                <label>Filtrar por mes (emisión)</label>
                <select value={filtroMesCxc} onChange={e => setFiltroMesCxc(e.target.value)}>
                  <option value="todos">Todos los meses</option>
                  {mesesDisponibles(data.cxcAll, 'fecha_venta').map(m => (
                    <option key={m} value={m}>{labelMes(m)}</option>
                  ))}
                </select>
              </div>
              {filtroMesCxc !== 'todos' && (
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 18 }}>
                  {cxcFiltrado.length} registro(s) en {labelMes(filtroMesCxc)}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Total por Cobrar', value: fmtUSD(kTotal),                      color: 'var(--red)'   },
                { label: 'Pendiente',        value: fmtUSD(kPend.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--amber)', sub: `${kPend.length} facturas` },
                { label: 'Parcial',          value: fmtUSD(kParc.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--blue)',  sub: `${kParc.length} facturas` },
                { label: 'Vencidas',         value: fmtUSD(kVenc.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--red)',   sub: `${kVenc.length} facturas` },
                { label: filtroMesCxc === 'todos' ? 'Cobrado este Mes' : 'Cobrado en el período', value: fmtUSD(filtroMesCxc === 'todos' ? data.cxcKpis.cobradoMes : kCobrado), color: 'var(--green)' },
              ].map(k => (
                <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                  {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={() => { setEditCxc(null); setShowCxcModal(true) }}>+ Nueva CxC</button>
              </div>
              <CXCTable rows={cxcFiltrado} tipo="cxc"
                onAbono={(id, saldo, label) => setAbonoCtx({ tipo: 'cxc', id, saldo, label })}
                onEdit={(row) => { setEditCxc(row as unknown as typeof editCxc); setShowCxcModal(true) }}
                onDelete={async (id) => {
                  await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_cxc', id }) })
                  reload()
                }}
              />
            </div>
          </div>
        )
      })()}

      {/* ── CPP ── */}
      {tab === 'cpp' && (() => {
        const cppFiltrado = filtrarPorMes(data.cppAll, filtroMesCpp, 'fecha_emision')
        const kTotal    = cppFiltrado.reduce((a, x) => a + x.monto_pendiente, 0)
        // Mismo criterio que CxC — ver comentario arriba.
        const kVenc     = cppFiltrado.filter(x => estaVencida(x))
        const kPend     = cppFiltrado.filter(x => x.estado === 'Pendiente' && !estaVencida(x))
        const kParc     = cppFiltrado.filter(x => x.estado === 'Parcial' && !estaVencida(x))
        const kPagado   = cppFiltrado.filter(x => x.estado === 'Pagado').reduce((a, x) => a + x.monto_total, 0)

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="field" style={{ flex: '0 0 200px' }}>
                <label>Filtrar por mes (emisión)</label>
                <select value={filtroMesCpp} onChange={e => setFiltroMesCpp(e.target.value)}>
                  <option value="todos">Todos los meses</option>
                  {mesesDisponibles(data.cppAll, 'fecha_emision').map(m => (
                    <option key={m} value={m}>{labelMes(m)}</option>
                  ))}
                </select>
              </div>
              {filtroMesCpp !== 'todos' && (
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 18 }}>
                  {cppFiltrado.length} registro(s) en {labelMes(filtroMesCpp)}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Total por Pagar', value: fmtUSD(kTotal),                                    color: 'var(--red)'   },
                { label: 'Pendiente',       value: fmtUSD(kPend.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--amber)', sub: `${kPend.length} facturas` },
                { label: 'Parcial',         value: fmtUSD(kParc.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--blue)',  sub: `${kParc.length} facturas` },
                { label: 'Vencidas',        value: fmtUSD(kVenc.reduce((a,x)=>a+x.monto_pendiente,0)), color: 'var(--red)',   sub: `${kVenc.length} facturas` },
                { label: filtroMesCpp === 'todos' ? 'Pagado este Mes' : 'Pagado en el período', value: fmtUSD(filtroMesCpp === 'todos' ? data.cppKpis.pagadoMes : kPagado), color: 'var(--green)' },
              ].map(k => (
                <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
                  {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
                </div>
              ))}
            </div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={() => { setEditCpp(null); setShowCppModal(true) }}>+ Nueva CPP</button>
              </div>
              <CXCTable rows={cppFiltrado} tipo="cpp"
                onAbono={(id, saldo, label) => setAbonoCtx({ tipo: 'cpp', id, saldo, label })}
                onEdit={(row) => { setEditCpp(row as unknown as typeof editCpp); setShowCppModal(true) }}
                onDelete={async (id) => {
                  await fetch('/api/finanzas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_cpp', id }) })
                  reload()
                }}
              />
            </div>
          </div>
        )
      })()}

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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>📋 Registro de Costos Fijos</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" disabled={cargandoDevengoCF} onClick={generarDevengoCF} title="Registra en el libro contable los costos fijos activos del mes seleccionado arriba (en Balance)">
                  {cargandoDevengoCF ? '⏳...' : `📒 Generar devengo de ${mesSel}`}
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => { setEditCF(null); setShowCF(true) }}>+ Nuevo Costo</button>
              </div>
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
                    <span className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(cpp.monto_pendiente)}</span>
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
      {showCxcModal && (
        <CxcCppFormModal tipo="cxc"
          edit={editCxc ? { ...editCxc, nombre: editCxc.cliente } : null}
          onClose={() => { setShowCxcModal(false); setEditCxc(null) }}
          onSaved={() => { setShowCxcModal(false); setEditCxc(null); reload() }}
        />
      )}
      {showCppModal && (
        <CxcCppFormModal tipo="cpp"
          edit={editCpp ? { ...editCpp, nombre: editCpp.proveedor, monto: editCpp.monto_total } : null}
          onClose={() => { setShowCppModal(false); setEditCpp(null) }}
          onSaved={() => { setShowCppModal(false); setEditCpp(null); reload() }}
        />
      )}
      {tab === 'conciliacion' && (
        <ConciliacionTab />
      )}
      {tab === 'apertura' && <AperturaTab />}

    </div>
  )
}

// ─── TAB: Saldos de Apertura ─────────────────────────────────────────────────
function AperturaTab() {
  const [fechaCorte, setFechaCorte] = useState(new Date().toISOString().slice(0, 10))
  const [resumen, setResumen] = useState<{
    banco: { cuenta: string; monto: number }[]
    cxc: { cliente: string; monto_total: number }[]
    cpp: { proveedor: string; monto_total: number }[]
    inventario: unknown[]
    balance: { concepto: string; monto: number; tipo: string }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)

  // Formularios individuales
  const [bancoMonto, setBancoMonto] = useState(0)
  const [bancoCuenta, setBancoCuenta] = useState('Principal')
  const [cxcCliente, setCxcCliente] = useState('')
  const [cxcMonto, setCxcMonto] = useState(0)
  const [cppProveedor, setCppProveedor] = useState('')
  const [cppMonto, setCppMonto] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  // Asiento de apertura
  const [generandoAsiento, setGenerandoAsiento] = useState(false)
  const [asientoResultado, setAsientoResultado] = useState<{
    posteado: boolean
    totales: { montoBanco: number; montoCxc: number; montoCpp: number; montoInventario: number; montoPatrimonio: number }
  } | null>(null)

  async function cargar() {
    setLoading(true)
    try {
      const res = await fetch('/api/apertura')
      const d = await res.json()
      if (d.ok) setResumen(d)
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [])

  async function guardarBanco() {
    if (!bancoMonto || bancoMonto <= 0) return setMsg('⚠️ Ingresa un monto válido')
    setGuardando(true); setMsg('')
    try {
      const res = await fetch('/api/apertura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apertura_banco', fecha_corte: fechaCorte, cuenta: bancoCuenta, monto: bancoMonto }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMsg('✅ Saldo de banco registrado')
      setBancoMonto(0)
      cargar()
    } catch (e: unknown) { setMsg('❌ ' + (e instanceof Error ? e.message : 'Error')) }
    finally { setGuardando(false) }
  }

  async function guardarCxc() {
    if (!cxcCliente.trim() || !cxcMonto || cxcMonto <= 0) return setMsg('⚠️ Cliente y monto son requeridos')
    setGuardando(true); setMsg('')
    try {
      const res = await fetch('/api/apertura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apertura_cxc', fecha_corte: fechaCorte, cliente: cxcCliente, monto: cxcMonto }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMsg('✅ CxC de apertura registrada')
      setCxcCliente(''); setCxcMonto(0)
      cargar()
    } catch (e: unknown) { setMsg('❌ ' + (e instanceof Error ? e.message : 'Error')) }
    finally { setGuardando(false) }
  }

  async function guardarCpp() {
    if (!cppProveedor.trim() || !cppMonto || cppMonto <= 0) return setMsg('⚠️ Proveedor y monto son requeridos')
    setGuardando(true); setMsg('')
    try {
      const res = await fetch('/api/apertura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apertura_cpp', fecha_corte: fechaCorte, proveedor: cppProveedor, monto: cppMonto }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setMsg('✅ CPP de apertura registrada')
      setCppProveedor(''); setCppMonto(0)
      cargar()
    } catch (e: unknown) { setMsg('❌ ' + (e instanceof Error ? e.message : 'Error')) }
    finally { setGuardando(false) }
  }

  async function generarAsientoApertura() {
    if (!confirm(`¿Generar el asiento de apertura con fecha ${fechaCorte}?\n\nEsto contabiliza (o re-sincroniza) un solo asiento con todo lo que ya registraste aquí: banco, CxC, CPP e inventario.`)) return
    setGenerandoAsiento(true); setMsg(''); setAsientoResultado(null)
    try {
      const res = await fetch('/api/apertura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generar_asiento_apertura', fecha_corte: fechaCorte }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setAsientoResultado({ posteado: d.posteado, totales: d.totales })
      setMsg(d.posteado ? '✅ Asiento de apertura generado' : '⚠️ No se generó ningún asiento (no hay montos que contabilizar todavía)')
    } catch (e: unknown) { setMsg('❌ ' + (e instanceof Error ? e.message : 'Error')) }
    finally { setGenerandoAsiento(false) }
  }

  const totalBanco = (resumen?.banco ?? []).reduce((a, x) => a + x.monto, 0)
  const totalCxc   = (resumen?.cxc ?? []).reduce((a, x) => a + x.monto_total, 0)
  const totalCpp   = (resumen?.cpp ?? []).reduce((a, x) => a + x.monto_total, 0)

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, background: 'rgba(79,70,229,.05)', border: '1px solid rgba(79,70,229,.2)' }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>🔑 Saldos de Apertura</div>
        <p style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 12 }}>
          Registra aquí el punto de partida de la operación en vivo: el saldo real de banco, inventario,
          cuentas por cobrar y por pagar al momento del corte. Desde esta fecha en adelante, cada movimiento
          se registra y concilia normalmente.
        </p>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Fecha de corte</label>
          <input type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)} />
        </div>
      </div>

      {msg && (
        <div style={{ padding: '8px 14px', borderRadius: 'var(--r)', marginBottom: 14, fontSize: 12,
          background: msg.startsWith('✅') ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)',
          color: msg.startsWith('✅') ? '#16a34a' : 'var(--red)' }}>
          {msg}
        </div>
      )}

      {/* Resumen de lo ya cargado */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div className="kpi-card" style={{ borderTop: '3px solid var(--teal)' }}>
          <div className="kpi-label">🏦 Banco (apertura)</div>
          <div className="kpi-value" style={{ color: 'var(--teal)', fontSize: 18 }}>{fmtUSD(totalBanco)}</div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{resumen?.banco.length ?? 0} cuenta(s)</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid var(--green)' }}>
          <div className="kpi-label">💰 CxC (apertura)</div>
          <div className="kpi-value" style={{ color: 'var(--green)', fontSize: 18 }}>{fmtUSD(totalCxc)}</div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{resumen?.cxc.length ?? 0} cliente(s)</div>
        </div>
        <div className="kpi-card" style={{ borderTop: '3px solid var(--red)' }}>
          <div className="kpi-label">💸 CPP (apertura)</div>
          <div className="kpi-value" style={{ color: 'var(--red)', fontSize: 18 }}>{fmtUSD(totalCpp)}</div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{resumen?.cpp.length ?? 0} proveedor(es)</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20, background: 'rgba(22,163,74,.05)', border: '1px solid rgba(22,163,74,.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>📒 Asiento de Apertura</div>
            <p style={{ fontSize: 12, color: 'var(--txt3)', maxWidth: 560 }}>
              Genera un solo asiento contable con todo lo registrado arriba (banco, CxC, CPP e inventario) para
              iniciar el libro contable en la fecha de corte. Se puede volver a presionar después de cargar más
              saldos — resincroniza el mismo asiento en vez de duplicarlo.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={generarAsientoApertura} disabled={generandoAsiento}>
            {generandoAsiento ? 'Generando…' : '📒 Generar Asiento de Apertura'}
          </button>
        </div>
        {asientoResultado && (
          <div style={{ marginTop: 14, fontSize: 12, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 10 }}>
            <table className="tbl">
              <tbody>
                <tr><td>Debe Bancos</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(asientoResultado.totales.montoBanco)}</td></tr>
                <tr><td>Debe CxC Clientes</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(asientoResultado.totales.montoCxc)}</td></tr>
                <tr><td>Debe Inventario Disponible</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(asientoResultado.totales.montoInventario)}</td></tr>
                <tr><td>Haber CxP Proveedores</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(asientoResultado.totales.montoCpp)}</td></tr>
                <tr><td>{asientoResultado.totales.montoPatrimonio >= 0 ? 'Haber' : 'Debe'} Utilidades Retenidas (diferencia)</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(Math.abs(asientoResultado.totales.montoPatrimonio))}</td></tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Banco */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>🏦 Saldo bancario de apertura</div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Cuenta</label>
            <input value={bancoCuenta} onChange={e => setBancoCuenta(e.target.value)} placeholder="Principal" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Saldo real según el banco ($)</label>
            <input type="number" step="0.01" value={bancoMonto || ''} onChange={e => setBancoMonto(parseFloat(e.target.value) || 0)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={guardarBanco} disabled={guardando}>💾 Registrar saldo de banco</button>
          {(resumen?.banco.length ?? 0) > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt3)' }}>
              Ya registrado: {resumen!.banco.map(b => `${b.cuenta} (${fmtUSD(b.monto)})`).join(', ')}
            </div>
          )}
        </div>

        {/* Inventario */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>📦 Inventario de apertura</div>
          <p style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
            El conteo físico de inventario se carga producto por producto desde
            <strong> Inventario → Ajuste de stock</strong>, usando el motivo &quot;SALDO DE APERTURA&quot;.
            Esto asegura que cada ajuste pase por el mismo Kardex que ya usa todo el sistema.
          </p>
          <div style={{ fontSize: 11, color: resumen && resumen.inventario.length > 0 ? '#16a34a' : 'var(--amber)' }}>
            {resumen && resumen.inventario.length > 0
              ? `✅ ${resumen.inventario.length} productos con ajuste de apertura registrado`
              : '⚠️ Ningún producto tiene ajuste de apertura todavía'}
          </div>
        </div>

        {/* CxC */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>💰 Cuenta por cobrar de apertura</div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Cliente</label>
            <input value={cxcCliente} onChange={e => setCxcCliente(e.target.value)} placeholder="Nombre del cliente" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Monto que debe ($)</label>
            <input type="number" step="0.01" value={cxcMonto || ''} onChange={e => setCxcMonto(parseFloat(e.target.value) || 0)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={guardarCxc} disabled={guardando}>💾 Registrar CxC</button>
        </div>

        {/* CPP */}
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>💸 Cuenta por pagar de apertura</div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label>Proveedor</label>
            <input value={cppProveedor} onChange={e => setCppProveedor(e.target.value)} placeholder="Nombre del proveedor" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Monto que se debe ($)</label>
            <input type="number" step="0.01" value={cppMonto || ''} onChange={e => setCppMonto(parseFloat(e.target.value) || 0)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={guardarCpp} disabled={guardando}>💾 Registrar CPP</button>
        </div>
      </div>

      {!loading && resumen && (resumen.banco.length > 0 || resumen.cxc.length > 0 || resumen.cpp.length > 0) && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>📋 Detalle registrado</div>
          <table className="tbl">
            <thead><tr><th>Tipo</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
            <tbody>
              {resumen.banco.map((b, i) => (
                <tr key={`b${i}`}><td>🏦 Banco</td><td>{b.cuenta}</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(b.monto)}</td></tr>
              ))}
              {resumen.cxc.map((x, i) => (
                <tr key={`c${i}`}><td>💰 CxC</td><td>{x.cliente}</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(x.monto_total)}</td></tr>
              ))}
              {resumen.cpp.map((p, i) => (
                <tr key={`p${i}`}><td>💸 CPP</td><td>{p.proveedor}</td><td style={{ textAlign: 'right' }} className="mono">{fmtUSD(p.monto_total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

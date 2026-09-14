'use client'
import { useState } from 'react'
import ComisionesTab from './ComisionesTab'
import { fmtUSD, today } from '@/lib/utils'
import { PLANILLA } from '@/lib/constants'
import type { Empleado, PlanillaRegistro } from '@/lib/types'

interface PlanillaKpis {
  totalEmpleados: number; planillaNetoMes: number; planillaBrutoMes: number
  costoTotalMes: number; totalDeducciones: number; pagados: number; pendientes: number
}

interface Props {
  empleados: Empleado[]
  planillaMes: PlanillaRegistro[]
  planillaHistorico: { periodo: string; salario_bruto: number; salario_neto: number; costo_total_empresa: number; estado: string }[]
  comisiones: import('@/lib/types').ComisionRegistro[]
  kpis: PlanillaKpis
  mesActual: string
}

// ── Modal Empleado ─────────────────────────────────────────────────────────────
function EmpleadoModal({ edit, onClose, onSaved }: {
  edit: Empleado | null; onClose: () => void; onSaved: () => void
}) {
  const [nombre,    setNombre]    = useState(edit?.nombre ?? '')
  const [cargo,     setCargo]     = useState(edit?.cargo ?? '')
  const [depto,     setDepto]     = useState(edit?.departamento ?? '')
  const [salario,   setSalario]   = useState(edit?.salario_base ?? 0)
  const [ingreso,   setIngreso]   = useState(edit?.fecha_ingreso ?? '')
  const [dui,       setDui]       = useState(edit?.dui ?? '')
  const [nit,       setNit]       = useState(edit?.nit ?? '')
  const [nupIsss,   setNupIsss]   = useState(edit?.nup_isss ?? '')
  const [nupAfp,    setNupAfp]    = useState(edit?.nup_afp ?? '')
  const [afp,       setAfp]       = useState(edit?.afp ?? 'CRECER')
  const [tipoContrato, setTipoContrato] = useState((edit as unknown as { tipo_contrato?: string })?.tipo_contrato ?? 'empleado')
  const [activo,    setActivo]    = useState(edit?.activo !== false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  // Preview de deducciones en tiempo real
  const esHonorarios = tipoContrato === 'honorarios'
  const isssEmp = esHonorarios ? 0 : parseFloat((salario * PLANILLA.ISSS_EMPLEADO).toFixed(2))
  const afpEmp  = esHonorarios ? 0 : parseFloat((salario * PLANILLA.AFP_EMPLEADO).toFixed(2))
  const rentaPreview = esHonorarios
    ? parseFloat((salario * PLANILLA.RETENCION_HONORARIOS).toFixed(2))
    : 0
  const isssPat = esHonorarios ? 0 : parseFloat((salario * PLANILLA.ISSS_PATRONAL).toFixed(2))
  const afpPat  = esHonorarios ? 0 : parseFloat((salario * PLANILLA.AFP_PATRONAL).toFixed(2))
  const costoEmp = salario + isssPat + afpPat

  async function handleSave() {
    if (!nombre.trim()) return setError('Nombre requerido')
    if (!salario || salario <= 0) return setError('Salario requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/planilla', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_empleado', editId: edit?.id, nombre, cargo, departamento: depto, salario_base: salario, fecha_ingreso: ingreso || null, dui, nit, nup_isss: nupIsss, nup_afp: nupAfp, afp, tipo_contrato: tipoContrato, activo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 580 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Empleado' : '👨‍💼 Nuevo Empleado'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Nombre completo <span className="req">*</span></label><input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del empleado" /></div>
          <div className="field"><label>Cargo / Puesto</label><input value={cargo} onChange={e => setCargo(e.target.value)} placeholder="Gerente, Vendedor..." /></div>
          <div className="field"><label>Departamento</label><input value={depto} onChange={e => setDepto(e.target.value)} placeholder="Ventas, Operaciones..." /></div>
          <div className="field"><label>Salario base ($) <span className="req">*</span></label><input type="number" min="304.17" step="0.01" value={salario || ''} onChange={e => setSalario(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Fecha de ingreso</label><input type="date" value={ingreso} onChange={e => setIngreso(e.target.value)} /></div>
          <div className="field"><label>DUI</label><input value={dui} onChange={e => setDui(e.target.value)} placeholder="00000000-0" /></div>
          <div className="field"><label>NIT</label><input value={nit} onChange={e => setNit(e.target.value)} placeholder="0000-000000-000-0" /></div>
          <div className="field"><label>NUP ISSS</label><input value={nupIsss} onChange={e => setNupIsss(e.target.value)} placeholder="Número ISSS" /></div>
          <div className="field"><label>AFP</label><select value={afp} onChange={e => setAfp(e.target.value)}><option value="CRECER">CRECER</option><option value="CONFIA">CONFIA</option></select></div>
          <div className="field"><label>NUP AFP</label><input value={nupAfp} onChange={e => setNupAfp(e.target.value)} placeholder="Número AFP" /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Tipo de contrato / vínculo laboral <span className="req">*</span></label>
            <select value={tipoContrato} onChange={e => setTipoContrato(e.target.value)}>
              <option value="empleado">Empleado en planilla (ISSS + AFP + ISR)</option>
              <option value="honorarios">Servicios profesionales / Honorarios (solo retención ISR 10%)</option>
            </select>
          </div>
          {tipoContrato === 'honorarios' && (
            <div style={{ gridColumn: 'span 2', background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.25)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 11, color: 'var(--amber)' }}>
              ⚠️ <strong>Servicios profesionales:</strong> Se aplica únicamente retención ISR del 10% sobre el monto bruto (Art. 156 LISR). No aplica ISSS ni AFP porque no existe relación laboral formal.
            </div>
          )}
          <div className="field"><label>Estado</label><select value={activo ? 'Activo' : 'Inactivo'} onChange={e => setActivo(e.target.value === 'Activo')}><option>Activo</option><option>Inactivo</option></select></div>
        </div>

        {/* Preview de deducciones */}
        {salario > 0 && (
          <div style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 14, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>Preview de deducciones mensuales</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ color: 'var(--txt3)', marginBottom: 4 }}>Descuento al empleado:</div>
                {(esHonorarios ? [
                  { l: `Retención ISR (${(PLANILLA.RETENCION_HONORARIOS * 100).toFixed(0)}%)`, v: rentaPreview },
                  { l: 'Monto neto a pagar', v: salario - rentaPreview, bold: true, color: 'var(--green)' },
                ] : [
                  { l: `ISSS (${(PLANILLA.ISSS_EMPLEADO * 100).toFixed(0)}%)`, v: isssEmp },
                  { l: `AFP (${(PLANILLA.AFP_EMPLEADO * 100).toFixed(2)}%)`, v: afpEmp },
                  { l: 'ISR estimado', v: 0 },
                  { l: 'Salario neto', v: salario - isssEmp - afpEmp, bold: true, color: 'var(--green)' },
                ]).map(r => (
                  <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ color: 'var(--txt2)' }}>{r.l}</span>
                    <span className="mono" style={{ fontWeight: r.bold ? 800 : 600, color: r.color ?? 'var(--txt)' }}>{fmtUSD(r.v)}</span>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ color: 'var(--txt3)', marginBottom: 4 }}>
                  {esHonorarios ? 'Sin aporte patronal (honorarios)' : 'Aporte patronal (informativo):'}
                </div>
                {(esHonorarios ? [
                  { l: 'ISSS patronal', v: 0 },
                  { l: 'AFP patronal', v: 0 },
                  { l: 'Costo total empresa', v: salario, bold: true, color: 'var(--amber)' },
                ] : [
                  { l: `ISSS patronal (${(PLANILLA.ISSS_PATRONAL * 100).toFixed(1)}%)`, v: isssPat },
                  { l: `AFP patronal (${(PLANILLA.AFP_PATRONAL * 100).toFixed(2)}%)`, v: afpPat },
                  { l: 'Costo total empresa', v: costoEmp, bold: true, color: 'var(--amber)' },
                ]).map(r => (
                  <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ color: 'var(--txt2)' }}>{r.l}</span>
                    <span className="mono" style={{ fontWeight: r.bold ? 800 : 600, color: r.color ?? 'var(--txt)' }}>{fmtUSD(r.v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Guardando...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Registro Individual ─────────────────────────────────────────────────
function RegistroModal({ empleados, periodo, onClose, onSaved }: {
  empleados: Empleado[]; periodo: string; onClose: () => void; onSaved: () => void
}) {
  const [empId,   setEmpId]   = useState('')
  const [bruto,   setBruto]   = useState(0)
  const [otras,   setOtras]   = useState(0)
  const [bonos,   setBonos]   = useState(0)
  const [estado,  setEstado]  = useState('Pendiente')
  const [fechaPago, setFechaPago] = useState('')
  const [tipoPago, setTipoPago] = useState<'empleado'|'honorarios'>('empleado')
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [calculo, setCalculo] = useState<{ salarioNeto: number; isssEmp: number; afpEmp: number; renta: number; totalDeducc: number; costoEmpresa: number } | null>(null)

  function onPickEmp(id: string) {
    setEmpId(id)
    const emp = empleados.find(e => e.id === id)
    if (emp) {
      setBruto(emp.salario_base ?? 0)
      setTipoPago((emp as unknown as { tipo_contrato?: string })?.tipo_contrato === 'honorarios' ? 'honorarios' : 'empleado')
    }
  }

  async function handleSave() {
    if (!empId || !bruto) return setError('Empleado y salario bruto son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/planilla', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_planilla_registro', empleado_id: empId, periodo, tipo_pago: tipoPago, salario_bruto: bruto, otras_deducciones: otras, bonos, estado, fecha_pago: fechaPago || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCalculo(data.calculo)
      setTimeout(() => { onSaved() }, 1500)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Error') } finally { setSaving(false) }
  }

  const esHon    = tipoPago === 'honorarios'
  const isssEmp  = esHon ? 0 : parseFloat((bruto * PLANILLA.ISSS_EMPLEADO).toFixed(2))
  const afpEmp   = esHon ? 0 : parseFloat((bruto * PLANILLA.AFP_EMPLEADO).toFixed(2))
  const rentaReg = esHon ? parseFloat((bruto * PLANILLA.RETENCION_HONORARIOS).toFixed(2)) : 0
  const neto     = parseFloat((bruto - isssEmp - afpEmp - rentaReg - otras + bonos).toFixed(2))

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>📋 Registrar Planilla Individual</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        {calculo && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>✅ Planilla registrada. Salario neto: {fmtUSD(calculo.salarioNeto)}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Tipo de pago</label>
            <select value={tipoPago} onChange={e => setTipoPago(e.target.value as 'empleado'|'honorarios')}>
              <option value="empleado">Empleado en planilla (ISSS + AFP + ISR)</option>
              <option value="honorarios">Servicios profesionales / Honorarios (solo ISR 10%)</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Empleado <span className="req">*</span></label>
            <select value={empId} onChange={e => onPickEmp(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} — {fmtUSD(e.salario_base ?? 0)}/mes</option>)}
            </select>
          </div>
          <div className="field"><label>Salario bruto ($)</label><input type="number" min="0" step="0.01" value={bruto || ''} onChange={e => setBruto(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Bonos ($)</label><input type="number" min="0" step="0.01" value={bonos || ''} onChange={e => setBonos(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Otras deducciones ($)</label><input type="number" min="0" step="0.01" value={otras || ''} onChange={e => setOtras(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Estado</label><select value={estado} onChange={e => setEstado(e.target.value)}><option>Pendiente</option><option>Pagado</option></select></div>
          {estado === 'Pagado' && <div className="field"><label>Fecha de pago</label><input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} /></div>}
        </div>

        {bruto > 0 && (
          <div style={{ background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 14 }}>
            {esHon ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                <span style={{ color: 'var(--amber)' }}>Retención ISR ({(PLANILLA.RETENCION_HONORARIOS * 100).toFixed(0)}%)</span>
                <span className="mono" style={{ color: 'var(--amber)' }}>{fmtUSD(rentaReg)}</span>
              </div>
            ) : (<>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}><span style={{ color: 'var(--txt2)' }}>ISSS ({(PLANILLA.ISSS_EMPLEADO * 100).toFixed(0)}%)</span><span className="mono">{fmtUSD(isssEmp)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}><span style={{ color: 'var(--txt2)' }}>AFP ({(PLANILLA.AFP_EMPLEADO * 100).toFixed(2)}%)</span><span className="mono">{fmtUSD(afpEmp)}</span></div>
            </>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, borderTop: '1px solid var(--bdr)', paddingTop: 6, marginTop: 4 }}>
              <span>Salario neto estimado</span>
              <span className="mono" style={{ color: 'var(--green)' }}>{fmtUSD(neto)}</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Calculando...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── MÓDULO PRINCIPAL ──────────────────────────────────────────────────────────
export default function PlanillaModule({ empleados: initialEmp, planillaMes: initialPM, comisiones, kpis, mesActual }: Props) {
  const [tab,        setTab]        = useState<'empleados' | 'planilla' | 'comisiones'>('planilla')
  const [empleados]  = useState(initialEmp)
  const [planillaMes] = useState(initialPM)
  const [showEmp,    setShowEmp]    = useState(false)
  const [editEmp,    setEditEmp]    = useState<Empleado | null>(null)
  const [showReg,    setShowReg]    = useState(false)
  const [generando,  setGenerando]  = useState(false)

  function reload() { window.location.reload() }

  async function generarMes() {
    if (!confirm(`¿Generar planilla completa para ${mesActual}? Se crearán registros para todos los empleados activos (puede sobreescribir si ya existen).`)) return
    setGenerando(true)
    try {
      const res = await fetch('/api/planilla', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generar_planilla_mes', periodo: mesActual }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      alert(`✅ Planilla generada: ${data.generados} registros`)
      reload()
    } catch (e: unknown) {
      alert('Error: ' + (e instanceof Error ? e.message : 'desconocido'))
    } finally { setGenerando(false) }
  }

  async function pagarTodo() {
    if (!confirm(`¿Marcar toda la planilla de ${mesActual} como Pagada?`)) return
    const fechaPago = prompt('Fecha de pago (YYYY-MM-DD):', today())
    await fetch('/api/planilla', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pagar_planilla_mes', periodo: mesActual, fecha_pago: fechaPago }) })
    reload()
  }

  async function pagarIndividual(id: string) {
    const fechaPago = prompt('Fecha de pago (YYYY-MM-DD):', today())
    await fetch('/api/planilla', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pagar_planilla', id, fecha_pago: fechaPago }) })
    reload()
  }

  async function deleteEmp(id: string) {
    if (!confirm('¿Desactivar este empleado?')) return
    await fetch('/api/planilla', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_empleado', id }) })
    reload()
  }

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Empleados Activos',  value: String(kpis.totalEmpleados),    color: 'var(--teal)'   },
          { label: 'Planilla Bruta Mes', value: fmtUSD(kpis.planillaBrutoMes), color: 'var(--amber)'  },
          { label: 'Planilla Neta Mes',  value: fmtUSD(kpis.planillaNetoMes),  color: 'var(--green)'  },
          { label: 'Costo Total Empresa',value: fmtUSD(kpis.costoTotalMes),    color: 'var(--red)'    },
          { label: 'Total Deducciones',  value: fmtUSD(kpis.totalDeducciones), color: 'var(--purple)' },
          { label: 'Pagados / Pendientes',value: `${kpis.pagados} / ${kpis.pendientes}`, color: kpis.pendientes > 0 ? 'var(--amber)' : 'var(--green)' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs + acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          <button className={`tab-btn${tab === 'planilla'   ? ' active' : ''}`} onClick={() => setTab('planilla')}>📋 Planilla {mesActual}</button>
          <button className={`tab-btn${tab === 'empleados'  ? ' active' : ''}`} onClick={() => setTab('empleados')}>👨‍💼 Empleados</button>
          <button className={`tab-btn${tab === 'comisiones' ? ' active' : ''}`} onClick={() => setTab('comisiones')}>💰 Comisiones</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tab === 'planilla' && (<>
            <button className="btn btn-secondary" onClick={() => setShowReg(true)}>+ Registro Individual</button>
            <button className="btn btn-secondary" onClick={generarMes} disabled={generando}>
              {generando ? '⏳ Generando...' : '⚡ Generar Mes Completo'}
            </button>
            {kpis.pendientes > 0 && (
              <button className="btn btn-primary" onClick={pagarTodo} style={{ background: 'var(--green)', borderColor: 'var(--green)' }}>
                💰 Pagar Todo el Mes
              </button>
            )}
          </>)}
          {tab === 'empleados' && (
            <button className="btn btn-primary" onClick={() => { setEditEmp(null); setShowEmp(true) }}>+ Nuevo Empleado</button>
          )}
        </div>
      </div>

      {/* ── TAB PLANILLA ── */}
      {tab === 'planilla' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Empleado</th><th>Cargo</th><th>Salario Bruto</th>
                <th>ISSS Emp.</th><th>AFP Emp.</th><th>ISR</th><th>Total Deducc.</th>
                <th>Bonos</th><th>Salario Neto</th><th>Costo Empresa</th><th>Estado</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {planillaMes.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 700 }}>
                      {(p.empleado as unknown as { nombre: string })?.nombre ?? '–'}
                      {(p as unknown as { tipo_pago?: string }).tipo_pago === 'honorarios' && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--amber)', background: 'rgba(217,119,6,.15)', padding: '1px 5px', borderRadius: 4 }}>HONOR.</span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{(p.empleado as unknown as { cargo?: string })?.cargo ?? '–'}</td>
                    <td className="mono">{fmtUSD(p.salario_bruto)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>{fmtUSD(p.isss_empleado ?? 0)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>{fmtUSD(p.afp_empleado ?? 0)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>{fmtUSD(p.renta ?? 0)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>{fmtUSD(p.total_deducciones ?? 0)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--green)' }}>{fmtUSD(p.bonos ?? 0)}</td>
                    <td className="mono" style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtUSD(p.salario_neto ?? 0)}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmtUSD(p.costo_total_empresa ?? 0)}</td>
                    <td>
                      <span className={`badge ${p.estado === 'Pagado' ? 'badge-green' : p.estado === 'Anulado' ? 'badge-red' : 'badge-amber'}`}>
                        {p.estado}
                      </span>
                    </td>
                    <td>
                      {p.estado === 'Pendiente' && (
                        <button className="btn btn-primary btn-sm" style={{ background: 'var(--green)', borderColor: 'var(--green)', fontSize: 10 }}
                          onClick={() => pagarIndividual(p.id)}>
                          💰 Pagar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {planillaMes.length === 0 && (
                  <tr><td colSpan={12} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>
                    Sin planilla generada para {mesActual}. Usa &quot;Generar Mes Completo&quot; para crear todos los registros automáticamente.
                  </td></tr>
                )}
              </tbody>
              {planillaMes.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                    <td colSpan={2} style={{ padding: '10px 12px' }}>TOTALES</td>
                    <td className="mono">{fmtUSD(kpis.planillaBrutoMes)}</td>
                    <td colSpan={4} className="mono" style={{ color: 'var(--red)' }}>{fmtUSD(kpis.totalDeducciones)}</td>
                    <td></td>
                    <td className="mono" style={{ color: 'var(--green)' }}>{fmtUSD(kpis.planillaNetoMes)}</td>
                    <td className="mono" style={{ color: 'var(--amber)' }}>{fmtUSD(kpis.costoTotalMes)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── TAB EMPLEADOS ── */}
      {tab === 'empleados' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Nombre</th><th>Cargo</th><th>Tipo</th><th>Salario Base</th>
                <th>Deducc.</th><th>AFP</th><th>Costo Empresa</th><th>Fecha Ingreso</th><th>Estado</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {empleados.map(e => {
                  const isssEmp = parseFloat((e.salario_base * PLANILLA.ISSS_EMPLEADO).toFixed(2))
                  const afpEmp  = parseFloat((e.salario_base * PLANILLA.AFP_EMPLEADO).toFixed(2))
                  const isssPat = parseFloat((e.salario_base * PLANILLA.ISSS_PATRONAL).toFixed(2))
                  const afpPat  = parseFloat((e.salario_base * PLANILLA.AFP_PATRONAL).toFixed(2))
                  const costoEmp = e.salario_base + isssPat + afpPat
                  return (
                    <tr key={e.id}>
                      <td style={{ fontWeight: 700 }}>{e.nombre}</td>
                      <td style={{ fontSize: 11 }}>{e.cargo ?? '–'}</td>
                      <td>
                        {(e as unknown as { tipo_contrato?: string }).tipo_contrato === 'honorarios'
                          ? <span className="badge badge-amber">Honorarios</span>
                          : <span className="badge badge-blue">Empleado</span>
                        }
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(e.salario_base)}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>
                        {(e as unknown as { tipo_contrato?: string }).tipo_contrato === 'honorarios'
                          ? fmtUSD(e.salario_base * PLANILLA.RETENCION_HONORARIOS)
                          : fmtUSD(isssEmp + afpEmp)
                        }
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{e.afp ?? '–'}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--amber)' }}>{fmtUSD(costoEmp)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{e.fecha_ingreso ?? '–'}</td>
                      <td><span className={`badge ${e.activo !== false ? 'badge-green' : 'badge-gray'}`}>{e.activo !== false ? 'Activo' : 'Inactivo'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditEmp(e); setShowEmp(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteEmp(e.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {empleados.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin empleados registrados. Agrega el primer empleado para comenzar.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB COMISIONES ── */}
      {tab === 'comisiones' && (
        <ComisionesTab
          empleados={empleados.filter(e => e.activo !== false)}
          comisiones={comisiones}
          mesActual={mesActual}
        />
      )}

      {showEmp && <EmpleadoModal edit={editEmp} onClose={() => { setShowEmp(false); setEditEmp(null) }} onSaved={() => { setShowEmp(false); setEditEmp(null); reload() }} />}
      {showReg && <RegistroModal empleados={empleados.filter(e => e.activo !== false)} periodo={mesActual} onClose={() => setShowReg(false)} onSaved={() => { setShowReg(false); reload() }} />}
    </div>
  )
}

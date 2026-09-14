'use client'
import { useState, useEffect, useRef } from 'react'
import { fmtUSD, today } from '@/lib/utils'
import type { MovimientoBanco } from '@/lib/types'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ErpEntry {
  id: string; tipo_match: string; fecha: string
  descripcion: string; monto: number; referencia?: string
}

interface Kpis {
  totalMovimientos: number; totalCreditos: number; totalDebitos: number
  conciliados: number; sinConciliar: number; pctConciliado: number
  cobrosERP: number; abonosERP: number; pagosERP: number; gastosERP: number
}

interface ConciliacionData {
  mes: string; movimientos: MovimientoBanco[]
  ingresosERP: ErpEntry[]; egresosERP: ErpEntry[]; kpis: Kpis
}

// ─── Modal agregar movimiento manual ─────────────────────────────────────────
function AddMovModal({ onClose, onSaved }: {
  onClose: () => void; onSaved: () => void; mes?: string
}) {
  const [fecha,       setFecha]       = useState(today())
  const [descripcion, setDescripcion] = useState('')
  const [tipo,        setTipo]        = useState<'credito' | 'debito'>('credito')
  const [monto,       setMonto]       = useState('')
  const [referencia,  setReferencia]  = useState('')
  const [cuenta,      setCuenta]      = useState('Principal')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  async function handleSave() {
    if (!descripcion.trim() || !monto) return setError('Descripción y monto son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/conciliacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_movimiento', fecha, descripcion, tipo, monto: parseFloat(monto), referencia, cuenta }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>+ Movimiento bancario manual</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field">
            <label>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value as 'credito' | 'debito')}>
              <option value="credito">Crédito (ingreso)</option>
              <option value="debito">Débito (egreso)</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Descripción <span className="req">*</span></label>
            <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Descripción del movimiento" />
          </div>
          <div className="field">
            <label>Monto USD <span className="req">*</span></label>
            <input type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field">
            <label>Referencia banco</label>
            <input value={referencia} onChange={e => setReferencia(e.target.value)} placeholder="Nº ref., cheque..." />
          </div>
          <div className="field">
            <label>Cuenta</label>
            <input value={cuenta} onChange={e => setCuenta(e.target.value)} placeholder="Principal" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Import CSV modal ─────────────────────────────────────────────────────────
function ImportCSVModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [csv,     setCsv]     = useState('')
  const [cuenta,  setCuenta]  = useState('Principal')
  const [preview, setPreview] = useState<{ fecha: string; descripcion: string; tipo: 'credito' | 'debito'; monto: number }[]>([])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Parser CSV bancario simple: fecha, descripcion, crédito, débito (o columna única con signo)
  function parsearCSV(texto: string) {
    const lineas = texto.trim().split('\n').filter(l => l.trim())
    // Detectar si primera línea es encabezado
    const primera = lineas[0].toLowerCase()
    const inicio = primera.includes('fecha') || primera.includes('date') || primera.includes('descripcion') ? 1 : 0
    const rows: typeof preview = []
    for (let i = inicio; i < lineas.length; i++) {
      // Soporte para separador ; o ,
      const sep = lineas[i].includes(';') ? ';' : ','
      const cols = lineas[i].split(sep).map(c => c.trim().replace(/^"|"$/g, ''))
      if (cols.length < 3) continue
      const fecha = cols[0]
      const desc  = cols[1]
      // Columnas 2 y 3: crédito, débito — o columna 2 con signo
      let credito = 0, debito = 0
      if (cols.length >= 4) {
        credito = parseFloat(cols[2].replace(/[,$]/g, '')) || 0
        debito  = parseFloat(cols[3].replace(/[,$]/g, '')) || 0
      } else {
        const val = parseFloat(cols[2].replace(/[,$]/g, '')) || 0
        if (val >= 0) credito = val; else debito = Math.abs(val)
      }
      if (credito > 0) rows.push({ fecha, descripcion: desc, tipo: 'credito', monto: credito })
      if (debito  > 0) rows.push({ fecha, descripcion: desc, tipo: 'debito',  monto: debito })
    }
    setPreview(rows)
  }

  async function handleFile(file: File) {
    const text = await file.text()
    setCsv(text)
    parsearCSV(text)
  }

  async function importar() {
    if (!preview.length) return setError('Sin movimientos para importar')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/conciliacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_movimientos', movimientos: preview, cuenta }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al importar')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>📄 Importar estado de cuenta bancario (CSV)</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
          Formato esperado: <code>fecha, descripcion, credito, debito</code> (o columna única con signo).
          Separador: coma o punto y coma. La primera fila puede ser encabezado.
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Nombre de cuenta</label>
          <input value={cuenta} onChange={e => setCuenta(e.target.value)} placeholder="Principal, Ahorros..." />
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => inputRef.current?.click()}
          style={{ border: '2px dashed var(--bdr)', borderRadius: 8, padding: '24px 16px',
            textAlign: 'center', cursor: 'pointer', background: 'var(--surf2)', marginBottom: 12 }}>
          <input ref={inputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          <div style={{ fontSize: 24, marginBottom: 4 }}>📂</div>
          <div style={{ fontSize: 12 }}>Arrastra el CSV o haz clic</div>
        </div>

        {/* Textarea alternativa */}
        <textarea value={csv} onChange={e => { setCsv(e.target.value); parsearCSV(e.target.value) }}
          rows={4} placeholder="O pega el contenido CSV aquí..."
          style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--r)',
            border: '1px solid var(--bdr)', background: 'var(--surf)', color: 'var(--txt)',
            fontSize: 11, fontFamily: 'monospace', resize: 'vertical', marginBottom: 12, boxSizing: 'border-box' }} />

        {/* Preview */}
        {preview.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', marginBottom: 6 }}>
              Vista previa — {preview.length} movimientos detectados
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--bdr)', borderRadius: 'var(--r)' }}>
              <table style={{ width: '100%', fontSize: 11 }}>
                <thead><tr style={{ background: 'var(--surf2)' }}>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Fecha</th>
                  <th style={{ padding: '4px 8px', textAlign: 'left' }}>Descripción</th>
                  <th style={{ padding: '4px 8px', textAlign: 'center' }}>Tipo</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Monto</th>
                </tr></thead>
                <tbody>
                  {preview.slice(0, 20).map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--bdr)' }}>
                      <td style={{ padding: '3px 8px', fontFamily: 'monospace' }}>{r.fecha}</td>
                      <td style={{ padding: '3px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.descripcion}</td>
                      <td style={{ padding: '3px 8px', textAlign: 'center', color: r.tipo === 'credito' ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                        {r.tipo === 'credito' ? '▲ Crédito' : '▼ Débito'}
                      </td>
                      <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{fmtUSD(r.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 20 && <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--txt3)' }}>...y {preview.length - 20} más</div>}
            </div>
          </div>
        )}

        {error && <div style={{ background: 'rgba(220,38,38,.1)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={importar} disabled={saving || !preview.length}>
            {saving ? '⏳ Importando...' : `📥 Importar ${preview.length} movimientos`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────

// ─── Modal: Importar estado de cuenta bancario desde PDF ────────────────────────
// Usa un parser de texto determinístico (sin IA) — el PDF de Davivienda tiene capa
// de texto real y formato consistente, así que se extrae con reglas, no con IA.
// Costo: $0.00 siempre. Si el banco cambia de formato o el PDF es escaneado (sin
// texto), el parser lo indica claramente en vez de fallar en silencio.
function ImportarEstadoCuentaModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  type MovExtraido = { fecha: string; descripcion: string; monto: number; tipo: 'credito' | 'debito' }

  const [step, setStep] = useState<'subir' | 'revisar'>('subir')
  const [procesando, setProcesando] = useState(false)
  const [error, setError] = useState('')
  const [movimientos, setMovimientos] = useState<MovExtraido[]>([])
  const [cuenta, setCuenta] = useState('Principal')
  const [guardando, setGuardando] = useState(false)
  const [resultado, setResultado] = useState<{ importados: number } | null>(null)

  async function handleSeleccion(file: File) {
    setProcesando(true); setError('')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const res = await fetch('/api/estado-cuenta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: base64, anio: new Date().getFullYear() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al leer el documento')

      if (!data.movimientos?.length) {
        setError('No se encontraron movimientos en el documento')
        return
      }

      setMovimientos(data.movimientos)
      setStep('revisar')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al procesar el archivo')
    } finally {
      setProcesando(false)
    }
  }

  function actualizarMov(idx: number, campo: keyof MovExtraido, valor: string | number) {
    setMovimientos(prev => prev.map((m, i) => i === idx ? { ...m, [campo]: valor } : m))
  }

  function eliminarMov(idx: number) {
    setMovimientos(prev => prev.filter((_, i) => i !== idx))
  }

  const totalCreditos = movimientos.filter(m => m.tipo === 'credito').reduce((a, m) => a + m.monto, 0)
  const totalDebitos  = movimientos.filter(m => m.tipo === 'debito').reduce((a, m) => a + m.monto, 0)

  async function confirmarImportacion() {
    if (!movimientos.length) return
    setGuardando(true); setError('')
    try {
      const res = await fetch('/api/conciliacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_movimientos_bulk', movimientos, cuenta }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResultado(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  if (resultado) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onSaved()}>
        <div className="modal-box" style={{ maxWidth: 440, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
            {resultado.importados} movimientos importados
          </h3>
          <p style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 16 }}>
            Ya puedes cruzarlos contra el ERP desde la lista de movimientos.
          </p>
          <button className="btn btn-primary" onClick={onSaved}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>🏦 Importar estado de cuenta bancario</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 14 }}>
            {error}
          </div>
        )}

        {/* PASO 1: Subir archivo */}
        {step === 'subir' && (
          <div style={{ textAlign: 'center', padding: '36px 20px' }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>{procesando ? '⏳' : '📤'}</div>
            <p style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 6 }}>
              {procesando ? 'Leyendo el PDF...' : 'Sube el PDF del estado de cuenta bancario'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--green)', marginBottom: 18, fontWeight: 600 }}>
              ✓ Lectura por texto — sin IA, sin costo
            </p>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 'var(--r)',
              background: procesando ? 'var(--surf2)' : 'var(--indigo)',
              color: procesando ? 'var(--txt3)' : '#fff',
              fontSize: 13, fontWeight: 600, cursor: procesando ? 'not-allowed' : 'pointer',
            }}>
              📎 Seleccionar PDF
              <input
                type="file" accept="application/pdf" style={{ display: 'none' }}
                disabled={procesando}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleSeleccion(f); e.target.value = '' }}
              />
            </label>
          </div>
        )}

        {/* PASO 2: Revisar movimientos extraídos */}
        {step === 'revisar' && (
          <>
            <div style={{
              background: 'rgba(22,163,74,.06)', border: '1px solid rgba(22,163,74,.2)',
              borderRadius: 'var(--r)', padding: '8px 14px', marginBottom: 14,
              fontSize: 12, color: '#16a34a',
            }}>
              ✅ Extraído por lectura de texto — $0.00 de costo
            </div>

            <div className="field" style={{ marginBottom: 14, maxWidth: 220 }}>
              <label>Cuenta bancaria</label>
              <input value={cuenta} onChange={e => setCuenta(e.target.value)} placeholder="Principal, USD, etc." />
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
              <span>📥 Créditos: <strong style={{ color: '#16a34a' }}>{fmtUSD(totalCreditos)}</strong></span>
              <span>📤 Débitos: <strong style={{ color: 'var(--red)' }}>{fmtUSD(totalDebitos)}</strong></span>
              <span style={{ color: 'var(--txt3)' }}>{movimientos.length} movimientos detectados</span>
            </div>

            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--bdr)', borderRadius: 'var(--r)' }}>
              <table className="tbl">
                <thead>
                  <tr><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Monto</th><th></th></tr>
                </thead>
                <tbody>
                  {movimientos.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <input type="date" value={m.fecha} onChange={e => actualizarMov(i, 'fecha', e.target.value)}
                          style={{ width: 130, border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }} />
                      </td>
                      <td>
                        <input value={m.descripcion} onChange={e => actualizarMov(i, 'descripcion', e.target.value)}
                          style={{ width: '100%', minWidth: 160, border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                      </td>
                      <td>
                        <select value={m.tipo} onChange={e => actualizarMov(i, 'tipo', e.target.value)}
                          style={{ border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }}>
                          <option value="credito">Crédito</option>
                          <option value="debito">Débito</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" step="0.01" value={m.monto} onChange={e => actualizarMov(i, 'monto', Number(e.target.value))}
                          style={{ width: 80, border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                      </td>
                      <td>
                        <button onClick={() => eliminarMov(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmarImportacion} disabled={guardando || !movimientos.length}>
                {guardando ? '⏳ Guardando...' : `💾 Importar ${movimientos.length} movimientos`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function ConciliacionTab() {
  const [data,       setData]       = useState<ConciliacionData | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [mes,        setMes]        = useState(new Date().toISOString().slice(0, 7))
  const [showAddMov, setShowAddMov] = useState(false)
  const [showCSV,    setShowCSV]    = useState(false)
  const [showPdf,    setShowPdf]    = useState(false)
  const [filterConc, setFilterConc] = useState<'all' | 'sin' | 'con'>('all')
  const [filterTipo, setFilterTipo] = useState<'all' | 'credito' | 'debito'>('all')
  const [matchMov,   setMatchMov]   = useState<MovimientoBanco | null>(null)
  const [procesandoAuto, setProcesandoAuto] = useState(false)
  const [resultAuto,     setResultAuto]     = useState<{ total: number; conciliados: number; ambiguos: number; sinMatch: number } | null>(null)

  async function ejecutarAutoConciliar() {
    setProcesandoAuto(true); setResultAuto(null)
    try {
      const res = await fetch('/api/conciliacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_conciliar_mes', mes }),
      })
      const d = await res.json()
      if (res.ok) { setResultAuto(d); cargar() }
    } finally {
      setProcesandoAuto(false)
    }
  }

  async function cargar(m = mes) {
    setLoading(true)
    try {
      const res = await fetch(`/api/conciliacion?mes=${m}`)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [mes]) // eslint-disable-line

  async function toggleConciliado(id: string, actual: boolean) {
    await fetch('/api/conciliacion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_conciliado', mov_id: id, conciliado: !actual }),
    })
    setData(d => d ? { ...d, movimientos: d.movimientos.map(m => m.id === id ? { ...m, conciliado: !actual } : m) } : d)
  }

  async function conciliarConERP(movId: string, erp: ErpEntry) {
    await fetch('/api/conciliacion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'conciliar', mov_id: movId, tipo_match: erp.tipo_match, referencia_erp: erp.id }),
    })
    setData(d => d ? { ...d, movimientos: d.movimientos.map(m => m.id === movId ? { ...m, conciliado: true, tipo_match: erp.tipo_match as never } : m) } : d)
    setMatchMov(null)
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este movimiento?')) return
    await fetch('/api/conciliacion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_movimiento', id }),
    })
    setData(d => d ? { ...d, movimientos: d.movimientos.filter(m => m.id !== id) } : d)
  }

  const movs = data?.movimientos ?? []
  const filtrados = movs.filter(m => {
    if (filterConc === 'sin' && m.conciliado)  return false
    if (filterConc === 'con' && !m.conciliado) return false
    if (filterTipo !== 'all' && m.tipo !== filterTipo) return false
    return true
  })

  const k = data?.kpis

  return (
    <div>
      {/* Controles de mes y acciones */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="month" value={mes} onChange={e => setMes(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 13 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setShowPdf(true)}>🏦 Importar estado de cuenta (PDF)</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowCSV(true)}>📄 Importar CSV banco</button>
        <button className="btn btn-primary btn-sm" onClick={ejecutarAutoConciliar} disabled={procesandoAuto}>
          {procesandoAuto ? '⏳ Cruzando...' : '⚡ Cruce automático del mes'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAddMov(true)}>+ Manual</button>
        <button className="btn btn-secondary btn-sm" onClick={() => cargar()}>🔄 Recargar</button>
      </div>

      {resultAuto && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--r)', marginBottom: 16,
          background: resultAuto.conciliados > 0 ? 'rgba(22,163,74,.08)' : 'rgba(217,119,6,.08)',
          border: `1px solid ${resultAuto.conciliados > 0 ? 'rgba(22,163,74,.25)' : 'rgba(217,119,6,.25)'}`,
          fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ⚡ Cruce automático — {resultAuto.total} movimientos procesados
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{ color: '#16a34a' }}>✅ {resultAuto.conciliados} conciliados automáticamente</span>
            {resultAuto.ambiguos > 0 && <span style={{ color: 'var(--amber)' }}>⚠️ {resultAuto.ambiguos} ambiguos (varios candidatos)</span>}
            {resultAuto.sinMatch > 0 && <span style={{ color: 'var(--txt3)' }}>— {resultAuto.sinMatch} sin ningún candidato en el ERP</span>}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>⏳ Cargando...</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Movimientos',    value: String(k?.totalMovimientos ?? 0), color: 'var(--teal)',  sub: mes },
              { label: 'Conciliados',    value: `${k?.conciliados ?? 0} / ${k?.totalMovimientos ?? 0}`, color: '#16a34a', sub: `${k?.pctConciliado ?? 0}%` },
              { label: 'Sin conciliar',  value: String(k?.sinConciliar ?? 0),    color: k?.sinConciliar ? '#d97706' : '#16a34a', sub: 'pendientes' },
              { label: 'Créditos banco', value: fmtUSD(k?.totalCreditos ?? 0),   color: '#16a34a',  sub: 'entradas' },
              { label: 'Débitos banco',  value: fmtUSD(k?.totalDebitos ?? 0),    color: '#dc2626',  sub: 'salidas' },
              { label: 'Cobros ERP',     value: fmtUSD((k?.cobrosERP ?? 0) + (k?.abonosERP ?? 0)), color: 'var(--teal)', sub: 'ventas + abonos' },
              { label: 'Pagos ERP',      value: fmtUSD((k?.pagosERP ?? 0) + (k?.gastosERP ?? 0)),  color: '#7c3aed', sub: 'CPP + gastos' },
              { label: 'Diferencia',
                value: fmtUSD(Math.abs((k?.totalCreditos ?? 0) - (k?.totalDebitos ?? 0) - ((k?.cobrosERP ?? 0) + (k?.abonosERP ?? 0) - (k?.pagosERP ?? 0) - (k?.gastosERP ?? 0)))),
                color: 'var(--txt3)', sub: 'banco vs ERP' },
            ].map(k2 => (
              <div key={k2.label} className="kpi-card" style={{ borderTop: `3px solid ${k2.color}` }}>
                <div className="kpi-label">{k2.label}</div>
                <div className="kpi-value" style={{ color: k2.color, fontSize: 16 }}>{k2.value}</div>
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k2.sub}</div>
              </div>
            ))}
          </div>

          {/* Filtros tabla */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {(['all', 'sin', 'con'] as const).map(f => (
              <button key={f} className={`btn btn-sm ${filterConc === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterConc(f)}>
                {f === 'all' ? 'Todos' : f === 'sin' ? `Sin conciliar (${k?.sinConciliar ?? 0})` : `Conciliados (${k?.conciliados ?? 0})`}
              </button>
            ))}
            <div style={{ width: 1, background: 'var(--bdr)', margin: '0 4px' }} />
            {(['all', 'credito', 'debito'] as const).map(f => (
              <button key={f} className={`btn btn-sm ${filterTipo === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilterTipo(f)}>
                {f === 'all' ? 'Todos los tipos' : f === 'credito' ? '▲ Créditos' : '▼ Débitos'}
              </button>
            ))}
          </div>

          {/* Tabla movimientos */}
          {filtrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--txt3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🏦</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {movs.length === 0 ? 'Sin movimientos bancarios para este mes' : 'Sin resultados con estos filtros'}
              </div>
              {movs.length === 0 && (
                <div style={{ marginTop: 10, display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowPdf(true)}>🏦 Estado de cuenta PDF</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowCSV(true)}>📄 Importar CSV</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setShowAddMov(true)}>+ Agregar manual</button>
                </div>
              )}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>✓</th><th>Fecha</th><th>Descripción</th><th>Ref. banco</th>
                  <th style={{ textAlign: 'right' }}>Crédito</th>
                  <th style={{ textAlign: 'right' }}>Débito</th>
                  <th>Match ERP</th><th>Cuenta</th><th></th>
                </tr></thead>
                <tbody>
                  {filtrados.map(m => (
                    <tr key={m.id} style={{ opacity: m.conciliado ? .7 : 1 }}>
                      <td>
                        <input type="checkbox" checked={m.conciliado}
                          onChange={() => toggleConciliado(m.id, m.conciliado)}
                          style={{ cursor: 'pointer', width: 14, height: 14 }} />
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{m.fecha}</td>
                      <td style={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.descripcion}
                      </td>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{m.referencia ?? '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#16a34a', fontWeight: m.tipo === 'credito' ? 700 : 400 }}>
                        {m.tipo === 'credito' ? fmtUSD(m.monto) : '—'}
                      </td>
                      <td className="mono" style={{ textAlign: 'right', color: '#dc2626', fontWeight: m.tipo === 'debito' ? 700 : 400 }}>
                        {m.tipo === 'debito' ? fmtUSD(m.monto) : '—'}
                      </td>
                      <td>
                        {m.conciliado ? (
                          <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>
                            ✓ {m.tipo_match ?? 'manual'}
                          </span>
                        ) : (
                          <button className="btn btn-secondary btn-sm"
                            style={{ fontSize: 10 }}
                            onClick={() => setMatchMov(m)}>
                            🔗 Cruzar ERP
                          </button>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{m.cuenta}</td>
                      <td>
                        <button className="btn btn-danger btn-sm" onClick={() => eliminar(m.id)}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal cruzar con ERP */}
      {matchMov && data && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setMatchMov(null)}>
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 800, fontSize: 15 }}>🔗 Cruzar con registro ERP</h3>
              <button onClick={() => setMatchMov(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
            </div>
            <div style={{ marginBottom: 14, padding: 12, background: 'var(--surf2)', borderRadius: 'var(--r)', fontSize: 12 }}>
              <div><strong>Movimiento:</strong> {matchMov.descripcion}</div>
              <div><strong>Monto:</strong> {fmtUSD(matchMov.monto)} ({matchMov.tipo})</div>
              <div><strong>Fecha:</strong> {matchMov.fecha}</div>
            </div>

            {/* Candidatos del ERP */}
            {(matchMov.tipo === 'credito' ? data.ingresosERP : data.egresosERP).length === 0 ? (
              <div style={{ color: 'var(--txt3)', fontSize: 13, padding: 16, textAlign: 'center' }}>
                Sin registros ERP del mismo tipo en el período
              </div>
            ) : (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {(matchMov.tipo === 'credito' ? data.ingresosERP : data.egresosERP)
                  .sort((a, b) => Math.abs(a.monto - matchMov.monto) - Math.abs(b.monto - matchMov.monto))
                  .map(erp => {
                    const diff = Math.abs(erp.monto - matchMov.monto)
                    const match = diff < 1
                    return (
                      <div key={erp.id} onClick={() => conciliarConERP(matchMov.id, erp)}
                        style={{ padding: '10px 14px', borderTop: '1px solid var(--bdr)', cursor: 'pointer',
                          background: match ? 'rgba(22,163,74,.06)' : 'transparent',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          transition: 'background .15s' }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: match ? 700 : 500 }}>{erp.descripcion}</div>
                          <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{erp.fecha} · {erp.tipo_match}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{fmtUSD(erp.monto)}</span>
                          {match && <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>✓ match</span>}
                          {!match && diff < 10 && <span style={{ fontSize: 10, color: '#d97706' }}>~{fmtUSD(diff)}</span>}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => conciliarConERP(matchMov.id, { id: '', tipo_match: 'manual', fecha: '', descripcion: '', monto: 0 })}>
                ✓ Marcar conciliado sin cruzar
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMov && <AddMovModal mes={mes} onClose={() => setShowAddMov(false)} onSaved={() => { setShowAddMov(false); cargar() }} />}
      {showCSV    && <ImportCSVModal onClose={() => setShowCSV(false)} onSaved={() => { setShowCSV(false); cargar() }} />}
      {showPdf    && <ImportarEstadoCuentaModal onClose={() => setShowPdf(false)} onSaved={() => { setShowPdf(false); cargar() }} />}
    </div>
  )
}

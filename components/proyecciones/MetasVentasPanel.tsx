'use client'
import { useState, useEffect } from 'react'
import { fmtUSD } from '@/lib/utils'

interface MetaPeriodo {
  id: string; periodo: string; vendedor_id?: string; meta_monto: number
  meta_unidades?: number; notas?: string
  vendedor?: { nombre: string; cargo?: string }
  real: number; pct: number
}
interface Empleado { id: string; nombre: string; cargo?: string }
interface MetasData {
  periodo: string; metasPeriodo: MetaPeriodo[]
  empleados: Empleado[]; realGlobal: number
  metaGlobal?: { meta_monto: number }
}

// ─── Barra de progreso meta ───────────────────────────────────────────────────
function BarraMeta({ pct, real, meta }: { pct: number; real: number; meta: number }) {
  const color = pct >= 100 ? '#16a34a' : pct >= 75 ? '#0891b2' : pct >= 50 ? '#d97706' : '#dc2626'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
        <span style={{ color: 'var(--txt3)' }}>{fmtUSD(real)} de {fmtUSD(meta)}</span>
        <span style={{ fontWeight: 800, color }}>{pct}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--surf2)', borderRadius: 99, border: '1px solid var(--bdr)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`,
          background: color, borderRadius: 99, transition: 'width .4s ease' }} />
      </div>
      {pct > 100 && (
        <div style={{ fontSize: 10, color: '#16a34a', marginTop: 3, fontWeight: 700 }}>
          🏆 Meta superada por {fmtUSD(real - meta)}
        </div>
      )}
    </div>
  )
}

// ─── Modal de meta ────────────────────────────────────────────────────────────
function MetaModal({ meta, empleados, onClose, onSaved }: {
  meta: Partial<MetaPeriodo> & { periodo: string } | null
  empleados: Empleado[]; onClose: () => void; onSaved: () => void
}) {
  const [periodo,     setPeriodo]     = useState(meta?.periodo ?? new Date().toISOString().slice(0, 7))
  const [vendedorId,  setVendedorId]  = useState(meta?.vendedor_id ?? '')
  const [metaMonto,   setMetaMonto]   = useState(meta?.meta_monto ? String(meta.meta_monto) : '')
  const [notas,       setNotas]       = useState(meta?.notas ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  async function handleSave() {
    if (!metaMonto || parseFloat(metaMonto) <= 0) return setError('La meta debe ser mayor a $0')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/metas-ventas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_meta', id: meta?.id, periodo, vendedor_id: vendedorId, meta_monto: metaMonto, notas }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{meta?.id ? '✏️ Editar meta' : '🎯 Nueva meta de ventas'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Período <span className="req">*</span></label>
            <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} />
          </div>
          <div className="field">
            <label>Meta (USD) <span className="req">*</span></label>
            <input type="number" min="0" step="100" value={metaMonto}
              onChange={e => setMetaMonto(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Vendedor</label>
            <select value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
              <option value="">🏢 Meta global del negocio</option>
              {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` — ${e.cargo}` : ''}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notas</label>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Contexto de la meta..." />
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

// ─── Componente principal ─────────────────────────────────────────────────────
export default function MetasVentasPanel() {
  const [data,      setData]      = useState<MetasData | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [periodo,   setPeriodo]   = useState(new Date().toISOString().slice(0, 7))
  const [showModal, setShowModal] = useState(false)
  const [editMeta,  setEditMeta]  = useState<MetaPeriodo | null>(null)

  async function cargar(p = periodo) {
    setLoading(true)
    try {
      const res = await fetch(`/api/metas-ventas?periodo=${p}`)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, []) // eslint-disable-line
  useEffect(() => { cargar(periodo) }, [periodo]) // eslint-disable-line

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar esta meta?')) return
    await fetch('/api/metas-ventas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_meta', id }),
    })
    cargar()
  }

  const metaGlobal = data?.metasPeriodo.find(m => !m.vendedor_id)
  const metasVendedor = data?.metasPeriodo.filter(m => m.vendedor_id) ?? []

  return (
    <div>
      {/* Controles */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 13 }} />
        <button className="btn btn-primary btn-sm" onClick={() => { setEditMeta(null); setShowModal(true) }}>
          + Nueva meta
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>⏳ Cargando metas...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Meta global */}
          <div className="card" style={{ borderLeft: `4px solid ${metaGlobal ? 'var(--teal)' : 'var(--bdr)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>🏢 Meta global — {periodo}</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>Todas las ventas del negocio</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {metaGlobal && (
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditMeta(metaGlobal); setShowModal(true) }}>✏️</button>
                )}
                <button className="btn btn-primary btn-sm"
                  onClick={() => { setEditMeta(null); setShowModal(true) }}>
                  {metaGlobal ? '+ Nueva meta' : '+ Definir meta'}
                </button>
              </div>
            </div>

            {metaGlobal ? (
              <BarraMeta pct={metaGlobal.pct} real={metaGlobal.real} meta={metaGlobal.meta_monto} />
            ) : (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
                <div style={{ marginBottom: 4 }}>Sin meta definida para {periodo}</div>
                <div style={{ fontSize: 11 }}>
                  Real acumulado: <strong style={{ color: 'var(--teal)' }}>{fmtUSD(data?.realGlobal ?? 0)}</strong>
                </div>
              </div>
            )}

            {metaGlobal && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 14 }}>
                {[
                  { label: 'Real acumulado', value: fmtUSD(metaGlobal.real), color: 'var(--teal)' },
                  { label: 'Meta del mes',   value: fmtUSD(metaGlobal.meta_monto), color: 'var(--txt2)' },
                  { label: 'Diferencia',
                    value: fmtUSD(Math.abs(metaGlobal.real - metaGlobal.meta_monto)),
                    color: metaGlobal.real >= metaGlobal.meta_monto ? '#16a34a' : '#dc2626' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--surf2)', borderRadius: 'var(--r)' }}>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 16, color: k.color }}>{k.value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Metas por vendedor */}
          {metasVendedor.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 16 }}>👥 Metas por vendedor — {periodo}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {metasVendedor.map(m => (
                  <div key={m.id} style={{ padding: '12px 14px', background: 'var(--surf2)', borderRadius: 'var(--r)',
                    border: '1px solid var(--bdr)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{m.vendedor?.nombre ?? '—'}</div>
                        {m.vendedor?.cargo && <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{m.vendedor.cargo}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditMeta(m); setShowModal(true) }}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => eliminar(m.id)}>🗑</button>
                      </div>
                    </div>
                    <BarraMeta pct={m.pct} real={m.real} meta={m.meta_monto} />
                    {m.notas && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8 }}>📝 {m.notas}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Si no hay metas en el período */}
          {data?.metasPeriodo.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin metas para {periodo}</div>
              <div style={{ fontSize: 12, marginBottom: 16 }}>Define metas globales o por vendedor para hacer seguimiento del real</div>
              <button className="btn btn-primary btn-sm" onClick={() => { setEditMeta(null); setShowModal(true) }}>
                + Definir primera meta
              </button>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <MetaModal
          meta={editMeta ? editMeta : { periodo }}
          empleados={data?.empleados ?? []}
          onClose={() => { setShowModal(false); setEditMeta(null) }}
          onSaved={() => { setShowModal(false); setEditMeta(null); cargar() }}
        />
      )}
    </div>
  )
}

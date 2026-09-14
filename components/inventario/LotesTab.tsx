'use client'
import { useState } from 'react'
import type { Lote, Producto } from '@/lib/types'
import { today } from '@/lib/utils'

const UNIDADES = ['botella','caja','galón','litro','kg','gramo','unidad','docena','paquete','saco']

interface LoteKpis { totalLotes: number; vencidos: number; vencen30: number; vencen60: number; agotados: number }

interface Props {
  lotes: Lote[]; productos: Producto[]
  kpis: LoteKpis; hoy: string; en30s: string; en60s: string
}

function estadoLote(lote: Lote, hoy: string, en30s: string, en60s: string) {
  if ((lote.cantidad_actual ?? 0) <= 0) return { label: 'Agotado',       color: 'badge-gray'   }
  if (lote.fecha_vencimiento < hoy)     return { label: 'Vencido',       color: 'badge-red'    }
  if (lote.fecha_vencimiento <= en30s)  return { label: 'Vence ≤ 30d',  color: 'badge-red'    }
  if (lote.fecha_vencimiento <= en60s)  return { label: 'Vence ≤ 60d',  color: 'badge-amber'  }
  return                                       { label: 'Vigente',        color: 'badge-green'  }
}

function LoteModal({ productos, edit, onClose, onSaved }: {
  productos: Producto[]; edit: Lote | null; onClose: () => void; onSaved: () => void
}) {
  const [prodId,    setProdId]    = useState(edit?.producto_id ?? '')
  const [lote,      setLote]      = useState(edit?.numero_lote ?? '')
  const [vence,     setVence]     = useState(edit?.fecha_vencimiento ?? '')
  const [ingreso,   setIngreso]   = useState(edit?.fecha_ingreso ?? today())
  const [cantidad,  setCantidad]  = useState(edit?.cantidad_inicial ?? 0)
  const [notas,     setNotas]     = useState(edit?.notas ?? '')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  async function handleSave() {
    if (!prodId || !lote.trim() || !vence || !cantidad)
      return setError('Producto, lote, vencimiento y cantidad son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/lotes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_lote', editId: edit?.id,
          producto_id: prodId, numero_lote: lote, fecha_vencimiento: vence,
          fecha_ingreso: ingreso, cantidad_inicial: cantidad, notas,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  const prod = productos.find(p => p.id === prodId)
  const diasHastaVence = vence ? Math.ceil((new Date(vence).getTime() - Date.now()) / 86400000) : null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Lote' : '📦 Registrar Lote'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Producto <span className="req">*</span></label>
            <select value={prodId} onChange={e => setProdId(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {productos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
            </select>
          </div>
          {prod && (
            <div style={{ gridColumn: 'span 2', background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 11 }}>
              Unidad: <strong>{(prod as unknown as { unidad?: string }).unidad ?? 'unidad'}</strong>
              {' · '}Stock actual: <strong style={{ color: 'var(--teal)' }}>{prod.stock_actual}</strong>
            </div>
          )}
          <div className="field">
            <label>Número de lote <span className="req">*</span></label>
            <input value={lote} onChange={e => setLote(e.target.value.toUpperCase())} placeholder="LOTE-2026-03" />
          </div>
          <div className="field">
            <label>Fecha de vencimiento <span className="req">*</span></label>
            <input type="date" value={vence} onChange={e => setVence(e.target.value)} />
          </div>
          {diasHastaVence !== null && (
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: diasHastaVence < 0 ? 'rgba(220,38,38,.15)' : diasHastaVence <= 30 ? 'rgba(220,38,38,.1)' : diasHastaVence <= 60 ? 'rgba(217,119,6,.1)' : 'rgba(22,163,74,.1)',
                color: diasHastaVence < 0 ? 'var(--red)' : diasHastaVence <= 30 ? 'var(--red)' : diasHastaVence <= 60 ? 'var(--amber)' : 'var(--green)',
              }}>
                {diasHastaVence < 0 ? `⚠️ Vencido hace ${Math.abs(diasHastaVence)} días` : `📅 Vence en ${diasHastaVence} días`}
              </span>
            </div>
          )}
          <div className="field">
            <label>Fecha de ingreso</label>
            <input type="date" value={ingreso} onChange={e => setIngreso(e.target.value)} />
          </div>
          <div className="field">
            <label>Cantidad <span className="req">*</span></label>
            <input type="number" min="1" value={cantidad || ''} onChange={e => setCantidad(parseInt(e.target.value) || 0)} />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notas</label>
            <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Proveedor, número de factura, condiciones..." />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar Lote'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LotesTab({ lotes: initialLotes, productos, kpis, hoy, en30s, en60s }: Props) {
  const [lotes,      setLotes]      = useState(initialLotes)
  const [showModal,  setShowModal]  = useState(false)
  const [editLote,   setEditLote]   = useState<Lote | null>(null)
  const [filterProd, setFilterProd] = useState('')
  const [filterEst,  setFilterEst]  = useState('')
  const [search,     setSearch]     = useState('')

  const filtered = lotes.filter(l => {
    if (filterProd && l.producto_id !== filterProd) return false
    const est = estadoLote(l, hoy, en30s, en60s).label
    if (filterEst === 'vigente'    && est !== 'Vigente')     return false
    if (filterEst === 'vencido'    && est !== 'Vencido')     return false
    if (filterEst === 'vence30'    && est !== 'Vence ≤ 30d') return false
    if (filterEst === 'vence60'    && est !== 'Vence ≤ 60d') return false
    if (filterEst === 'agotado'    && est !== 'Agotado')     return false
    const nomProd = (l.producto as unknown as { nombre?: string })?.nombre ?? ''
    if (search && !l.numero_lote.toLowerCase().includes(search.toLowerCase()) &&
        !nomProd.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function deleteLote(id: string) {
    if (!confirm('¿Desactivar este lote?')) return
    await fetch('/api/lotes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_lote', id }) })
    setLotes(l => l.filter(x => x.id !== id))
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Lotes Activos', value: String(kpis.totalLotes), color: 'var(--teal)'  },
          { label: 'Vencidos',      value: String(kpis.vencidos),   color: 'var(--red)'   },
          { label: 'Vencen ≤ 30d', value: String(kpis.vencen30),   color: 'var(--red)'   },
          { label: 'Vencen ≤ 60d', value: String(kpis.vencen60),   color: 'var(--amber)' },
          { label: 'Agotados',      value: String(kpis.agotados),   color: 'var(--gray)'  },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color ?? 'var(--bdr)'}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 20 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Alerta de vencidos con stock */}
      {kpis.vencidos > 0 && (
        <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--red)' }}>
          🚨 <strong>{kpis.vencidos} lote(s) vencido(s)</strong> aún tienen stock. Revisa y ajusta el inventario para evitar ventas de producto vencido.
        </div>
      )}

      {/* Controles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Buscar lote / producto..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)', minWidth: 180 }} />
          <select value={filterProd} onChange={e => setFilterProd(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
            <option value="">Todos los productos</option>
            {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select value={filterEst} onChange={e => setFilterEst(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
            <option value="">Todos los estados</option>
            <option value="vigente">Vigente</option>
            <option value="vence30">Vence ≤ 30 días</option>
            <option value="vence60">Vence ≤ 60 días</option>
            <option value="vencido">Vencido</option>
            <option value="agotado">Agotado</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditLote(null); setShowModal(true) }}>
          + Registrar Lote
        </button>
      </div>

      {/* Tabla */}
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Producto</th><th>Lote</th><th>Unidad</th>
              <th>Cant. inicial</th><th>Cant. actual</th>
              <th>Ingreso</th><th>Vencimiento</th><th>Estado</th><th>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(l => {
                const est = estadoLote(l, hoy, en30s, en60s)
                const prod = l.producto as unknown as { nombre?: string; codigo?: string; unidad?: string }
                return (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{prod?.nombre ?? '–'}</div>
                      <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{prod?.codigo ?? ''}</div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{l.numero_lote}</td>
                    <td><span className="badge badge-gray">{prod?.unidad ?? 'unidad'}</span></td>
                    <td className="mono" style={{ textAlign: 'center' }}>{l.cantidad_inicial}</td>
                    <td className="mono" style={{ textAlign: 'center', fontWeight: 700, color: (l.cantidad_actual ?? 0) <= 0 ? 'var(--txt3)' : 'var(--teal)' }}>
                      {l.cantidad_actual}
                    </td>
                    <td className="mono" style={{ fontSize: 11 }}>{l.fecha_ingreso ?? '–'}</td>
                    <td className="mono" style={{ fontSize: 11, fontWeight: 700, color: l.fecha_vencimiento <= en30s ? 'var(--red)' : l.fecha_vencimiento <= en60s ? 'var(--amber)' : 'var(--txt)' }}>
                      {l.fecha_vencimiento}
                    </td>
                    <td><span className={`badge ${est.color}`}>{est.label}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditLote(l); setShowModal(true) }}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteLote(l.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>
                  Sin lotes registrados. Al recibir una importación puedes registrar los lotes directamente.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 10, color: 'var(--txt3)', padding: '8px 0 0', fontStyle: 'italic' }}>
          📌 Orden FIFO: los lotes se muestran ordenados por fecha de vencimiento (primero el que vence antes).
        </div>
      </div>

      {showModal && (
        <LoteModal
          productos={productos}
          edit={editLote}
          onClose={() => { setShowModal(false); setEditLote(null) }}
          onSaved={() => { setShowModal(false); setEditLote(null); window.location.reload() }}
        />
      )}
    </div>
  )
}

export { UNIDADES }

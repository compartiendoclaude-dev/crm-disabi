'use client'
import { useState, useEffect } from 'react'
import { fmtUSD } from '@/lib/utils'

interface HistorialRow {
  id: string
  producto_id: string
  precio_venta_anterior?: number
  precio_venta_nuevo: number
  costo_anterior?: number
  costo_nuevo?: number
  motivo?: string
  usuario_email?: string
  created_at?: string
  producto?: { nombre: string; codigo: string; precio_venta: number; precio_costo?: number }
}

const MOTIVOS = ['Ajuste de mercado', 'Cambio proveedor', 'Campaña promocional', 'Aumento de costos', 'Corrección', 'Otro']

export default function PreciosHistorialTab({ productos }: {
  productos: { id: string; nombre: string; codigo: string }[]
}) {
  const [historial,   setHistorial]   = useState<HistorialRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [filterProd,  setFilterProd]  = useState('')
  const [editMotivo,  setEditMotivo]  = useState<{ id: string; motivo: string } | null>(null)
  const [savingM,     setSavingM]     = useState(false)

  async function cargar(pid = filterProd) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (pid) params.set('producto_id', pid)
      const res = await fetch(`/api/precios-historial?${params}`)
      if (res.ok) {
        const d = await res.json()
        setHistorial(d.historial)
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, []) // eslint-disable-line
  useEffect(() => { cargar(filterProd) }, [filterProd]) // eslint-disable-line

  async function guardarMotivo() {
    if (!editMotivo) return
    setSavingM(true)
    await fetch('/api/precios-historial', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'registrar_motivo', historial_id: editMotivo.id, motivo: editMotivo.motivo }),
    })
    setHistorial(h => h.map(r => r.id === editMotivo!.id ? { ...r, motivo: editMotivo!.motivo } : r))
    setEditMotivo(null)
    setSavingM(false)
  }

  function variacion(antes?: number, despues?: number) {
    if (!antes || !despues) return null
    const pct = ((despues - antes) / antes * 100)
    const color = pct > 0 ? '#dc2626' : '#16a34a'
    return <span style={{ color, fontSize: 11, fontWeight: 700 }}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</span>
  }

  return (
    <div>
      {/* Filtro */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterProd} onChange={e => setFilterProd(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', borderRadius: 'var(--r)',
            border: '1px solid var(--bdr)', background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
          <option value="">Todos los productos</option>
          {productos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{historial.length} cambios</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>⏳ Cargando historial...</div>
      ) : historial.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--txt3)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin cambios de precio registrados</div>
          <div style={{ fontSize: 12 }}>Los cambios se registran automáticamente al editar un producto</div>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Fecha</th>
              <th>Producto</th>
              <th style={{ textAlign: 'right' }}>Precio anterior</th>
              <th style={{ textAlign: 'right' }}>Precio nuevo</th>
              <th style={{ textAlign: 'center' }}>Variación</th>
              <th style={{ textAlign: 'right' }}>Costo anterior</th>
              <th style={{ textAlign: 'right' }}>Costo nuevo</th>
              <th>Motivo</th>
              <th>Usuario</th>
              <th></th>
            </tr></thead>
            <tbody>
              {historial.map(r => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {(r.created_at ?? '').replace('T', ' ').slice(0, 16)}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 600 }}>{r.producto?.nombre ?? '—'}</div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'monospace' }}>{r.producto?.codigo}</div>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--txt3)', fontSize: 12 }}>
                    {r.precio_venta_anterior != null ? fmtUSD(r.precio_venta_anterior) : '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontSize: 12 }}>
                    {fmtUSD(r.precio_venta_nuevo)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {variacion(r.precio_venta_anterior, r.precio_venta_nuevo) ?? <span style={{ color: 'var(--txt3)', fontSize: 11 }}>—</span>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: 'var(--txt3)', fontSize: 11 }}>
                    {r.costo_anterior != null ? fmtUSD(r.costo_anterior) : '—'}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontSize: 11 }}>
                    {r.costo_nuevo != null ? fmtUSD(r.costo_nuevo) : '—'}
                  </td>
                  <td style={{ fontSize: 11, color: r.motivo ? 'var(--txt)' : 'var(--txt3)', fontStyle: r.motivo ? 'normal' : 'italic' }}>
                    {r.motivo ?? 'Sin motivo'}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--txt3)' }}>
                    {r.usuario_email ? r.usuario_email.split('@')[0] : '—'}
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm"
                      onClick={() => setEditMotivo({ id: r.id, motivo: r.motivo ?? '' })}
                      title="Agregar motivo">✏️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal motivo */}
      {editMotivo && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setEditMotivo(null)}>
          <div className="modal-box" style={{ maxWidth: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 800, fontSize: 15 }}>✏️ Motivo del cambio</h3>
              <button onClick={() => setEditMotivo(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Motivo</label>
              <select value={editMotivo.motivo} onChange={e => setEditMotivo(m => m ? { ...m, motivo: e.target.value } : m)}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)', background: 'var(--surf)', color: 'var(--txt)', fontSize: 13 }}>
                <option value="">Seleccionar...</option>
                {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>O escribe uno personalizado</label>
              <input value={editMotivo.motivo} onChange={e => setEditMotivo(m => m ? { ...m, motivo: e.target.value } : m)}
                placeholder="Descripción del motivo..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setEditMotivo(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={guardarMotivo} disabled={savingM}>
                {savingM ? '⏳' : '💾 Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'
import { useState } from 'react'
import LotesTab from './LotesTab'
import PreciosHistorialTab from './PreciosHistorialTab'
import { fmtUSD, today } from '@/lib/utils'
import type { Producto, MovimientoInv } from '@/lib/types'

interface InventarioKpis {
  valorInventario: number; enReorden: number; sinStock: number
  topProdNombre: string; topProdRot: number; capitalInmovilizado: number; totalProductos: number
}

interface Props {
  productos: Producto[]
  movimientos: MovimientoInv[]
  kpis: InventarioKpis
  lotes: import('@/lib/types').Lote[]
  lotesKpis: { totalLotes: number; vencidos: number; vencen30: number; vencen60: number; agotados: number }
  hoy: string; en30s: string; en60s: string
}

const CATEGORIAS = ['Saborizante', 'Salsa', 'Accesorio', 'Dispensador', 'Insumo', 'Otro']
const UNIDADES   = ['unidad', 'caja', 'botella', 'galón', 'kg', 'litro', 'docena']
const TIPOS_MOV  = ['Entrada', 'Salida', 'Ajuste', 'Muestra']

function StockBadge({ stock, minimo }: { stock: number; minimo: number }) {
  if (stock <= 0) return <span className="badge badge-red">Sin stock</span>
  if (stock <= minimo) return <span className="badge badge-amber">Stock bajo</span>
  return <span className="badge badge-green">OK</span>
}

// ── Modal Producto ─────────────────────────────────────────────────────────────
function ProductoModal({ edit, onClose, onSaved }: {
  edit: Producto | null; onClose: () => void; onSaved: () => void
}) {
  const [codigo,   setCodigo]   = useState(edit?.codigo ?? '')
  const [nombre,   setNombre]   = useState(edit?.nombre ?? '')
  const [desc,     setDesc]     = useState('')
  const [cat,      setCat]      = useState(edit?.categoria ?? 'Otro')
  const [unidad,   setUnidad]   = useState('unidad')
  const [pventa,   setPventa]   = useState(edit?.precio_venta ?? 0)
  const [pcosto,   setPcosto]   = useState(0)
  const [stockIni, setStockIni] = useState(0)
  const [stockMin, setStockMin] = useState(edit ? (edit as unknown as { stock_minimo?: number }).stock_minimo ?? 0 : 0)
  const [activo,   setActivo]   = useState(edit?.activo !== false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const margen = pventa > 0 && pcosto > 0
    ? ((pventa - pcosto) / pventa * 100).toFixed(1) + '%' : '–'

  async function handleSave() {
    if (!codigo.trim() || !nombre.trim()) return setError('Código y nombre son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_producto', editId: edit?.id,
          codigo, nombre, descripcion: desc, categoria: cat, unidad,
          precio_venta: pventa, costo_unitario: pcosto,
          stock_inicial: stockIni, stock_minimo: stockMin, activo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Producto' : '📦 Nuevo Producto'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Código <span className="req">*</span></label>
            <input value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="ROJ-001" />
          </div>
          <div className="field">
            <label>Nombre <span className="req">*</span></label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del producto" />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={cat} onChange={e => setCat(e.target.value)}>
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Unidad de medida</label>
            <select value={unidad} onChange={e => setUnidad(e.target.value)}>
              {UNIDADES.map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Precio de venta ($)</label>
            <input type="number" min="0" step="0.01" value={pventa || ''} onChange={e => setPventa(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Costo unitario ($) {margen !== '–' && <span style={{ color: 'var(--green)', fontWeight: 700 }}>· Margen: {margen}</span>}</label>
            <input type="number" min="0" step="0.01" value={pcosto || ''} onChange={e => setPcosto(parseFloat(e.target.value) || 0)} />
          </div>
          {!edit && (
            <div className="field">
              <label>Stock inicial</label>
              <input type="number" min="0" value={stockIni} onChange={e => setStockIni(parseInt(e.target.value) || 0)} />
            </div>
          )}
          <div className="field">
            <label>Stock mínimo (punto de reorden)</label>
            <input type="number" min="0" value={stockMin} onChange={e => setStockMin(parseInt(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Descripción</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Descripción opcional" />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={activo ? 'true' : 'false'} onChange={e => setActivo(e.target.value === 'true')}>
              <option value="true">Activo</option>
              <option value="false">Inactivo</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Movimiento Manual ───────────────────────────────────────────────────
function MovimientoModal({ productos, onClose, onSaved }: {
  productos: Producto[]; onClose: () => void; onSaved: () => void
}) {
  const [prodId,   setProdId]   = useState('')
  const [tipo,     setTipo]     = useState('Entrada')
  const [cantidad, setCantidad] = useState(1)
  const [costo,    setCosto]    = useState(0)
  const [motivo,   setMotivo]   = useState('')
  const [fecha,    setFecha]    = useState(today())
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const prod = productos.find(p => p.id === prodId)

  async function handleSave() {
    if (!prodId) return setError('Selecciona un producto')
    if (!cantidad || cantidad <= 0) return setError('La cantidad debe ser mayor a 0')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_movimiento', producto_id: prodId,
          tipo: tipo.toLowerCase(), cantidad, costo_unitario: costo, motivo, fecha,
        }),
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
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>📋 Registrar Movimiento</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Producto <span className="req">*</span></label>
            <select value={prodId} onChange={e => setProdId(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {productos.map(p => (
                <option key={p.id} value={p.id}>{p.codigo} — {p.nombre} (Stock: {p.stock_actual})</option>
              ))}
            </select>
          </div>
          {prod && (
            <div style={{ gridColumn: 'span 2', background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12 }}>
              Stock actual: <strong style={{ color: 'var(--teal)' }}>{prod.stock_actual}</strong>
              {' · '}Stock mínimo: <strong>{(prod as unknown as { stock_minimo?: number }).stock_minimo ?? 0}</strong>
            </div>
          )}
          <div className="field">
            <label>Tipo de movimiento</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)}>
              {TIPOS_MOV.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Cantidad</label>
            <input type="number" min="1" value={cantidad} onChange={e => setCantidad(parseInt(e.target.value) || 1)} />
          </div>
          <div className="field">
            <label>Costo unitario ($)</label>
            <input type="number" min="0" step="0.01" value={costo || ''} onChange={e => setCosto(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Motivo / Referencia</label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ajuste de inventario, merma, muestra..." />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MÓDULO PRINCIPAL ──────────────────────────────────────────────────────────
export default function InventarioModule({ productos: initialProds, movimientos: initialMovs, kpis, lotes, lotesKpis, hoy, en30s, en60s }: Props) {
  const [tab,        setTab]        = useState<'catalogo' | 'kardex' | 'lotes' | 'precios'>('catalogo')
  const [productos,  setProductos]  = useState(initialProds)
  const [movimientos] = useState(initialMovs)
  const [showProd,   setShowProd]   = useState(false)
  const [editProd,   setEditProd]   = useState<Producto | null>(null)
  const [showMov,    setShowMov]    = useState(false)
  const [search,     setSearch]     = useState('')
  const [filterCat,  setFilterCat]  = useState('')
  const [filterStock, setFilterStock] = useState('')

  const categorias = Array.from(new Set(productos.map(p => p.categoria).filter(Boolean)))

  const filteredProds = productos.filter(p => {
    if (filterCat && p.categoria !== filterCat) return false
    if (filterStock === 'bajo'  && !((p.stock_actual || 0) <= ((p as unknown as { stock_minimo?: number }).stock_minimo ?? 0) && (p.stock_actual || 0) > 0)) return false
    if (filterStock === 'cero'  && (p.stock_actual || 0) > 0) return false
    if (filterStock === 'ok'    && (p.stock_actual || 0) <= ((p as unknown as { stock_minimo?: number }).stock_minimo ?? 0)) return false
    if (search && !p.nombre.toLowerCase().includes(search.toLowerCase()) &&
        !(p.codigo || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function reload() { window.location.reload() }

  async function deleteProducto(id: string) {
    if (!confirm('¿Desactivar este producto? No se eliminará del historial.')) return
    await fetch('/api/inventario', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_producto', id }) })
    setProductos(p => p.map(x => x.id === id ? { ...x, activo: false } : x))
  }

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Productos Activos',    value: String(kpis.totalProductos),    color: 'var(--teal)'   },
          { label: 'Valor Inventario',     value: fmtUSD(kpis.valorInventario),   color: 'var(--blue)'   },
          { label: 'En Punto de Reorden',  value: String(kpis.enReorden),         color: 'var(--amber)'  },
          { label: 'Sin Stock',            value: String(kpis.sinStock),           color: 'var(--red)'    },
          { label: 'Top Rotación',         value: kpis.topProdNombre,             color: 'var(--green)', sub: kpis.topProdRot + ' uds/mes' },
          { label: 'Capital Inmovilizado', value: fmtUSD(kpis.capitalInmovilizado), color: 'var(--amber)' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 16, wordBreak: 'break-word' }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Tabs + acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          <button className={`tab-btn${tab === 'catalogo' ? ' active' : ''}`} onClick={() => setTab('catalogo')}>📦 Catálogo</button>
          <button className={`tab-btn${tab === 'kardex'   ? ' active' : ''}`} onClick={() => setTab('kardex')}>📋 Kardex</button>
          <button className={`tab-btn${tab === 'lotes'    ? ' active' : ''}`} onClick={() => setTab('lotes')}>🗓️ Lotes y Vencimientos</button>
          <button className={`tab-btn${tab === 'precios'  ? ' active' : ''}`} onClick={() => setTab('precios')}>💲 Historial de Precios</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowMov(true)}>+ Movimiento</button>
          <button className="btn btn-primary" onClick={() => { setEditProd(null); setShowProd(true) }}>+ Nuevo Producto</button>
        </div>
      </div>

      {/* ── TAB CATÁLOGO ── */}
      {tab === 'catalogo' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)}
              style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)', minWidth: 180 }} />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
              <option value="">Todas las categorías</option>
              {categorias.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
            </select>
            <select value={filterStock} onChange={e => setFilterStock(e.target.value)}
              style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
              <option value="">Todo el stock</option>
              <option value="bajo">Stock bajo</option>
              <option value="cero">Sin stock</option>
              <option value="ok">Stock OK</option>
            </select>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th><th>Producto</th><th>Categoría</th><th>Unidad</th>
                <th>Stock</th><th>Mín.</th><th>Precio Vta.</th><th>Costo</th><th>Margen</th><th>Estado</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {filteredProds.map(p => {
                  const stockMin = (p as unknown as { stock_minimo?: number }).stock_minimo ?? 0
                  const costo    = (p as unknown as { costo_unitario?: number }).costo_unitario ?? 0
                  const margen   = p.precio_venta > 0 && costo > 0
                    ? ((p.precio_venta - costo) / p.precio_venta * 100).toFixed(1) + '%' : '–'
                  return (
                    <tr key={p.id}>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--txt3)' }}>{p.codigo}</td>
                      <td style={{ fontWeight: 600 }}>{p.nombre}</td>
                      <td style={{ fontSize: 11 }}>{p.categoria ?? '–'}</td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{(p as unknown as { unidad?: string }).unidad ?? '–'}</td>
                      <td className="mono" style={{ fontWeight: 700, color: (p.stock_actual || 0) <= 0 ? 'var(--red)' : (p.stock_actual || 0) <= stockMin ? 'var(--amber)' : 'var(--green)' }}>
                        {p.stock_actual}
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--txt3)' }}>{stockMin}</td>
                      <td className="mono" style={{ color: 'var(--teal)' }}>{fmtUSD(p.precio_venta)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtUSD(costo)}</td>
                      <td style={{ fontSize: 11, color: 'var(--green)' }}>{margen}</td>
                      <td><StockBadge stock={p.stock_actual} minimo={stockMin} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditProd(p); setShowProd(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteProducto(p.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filteredProds.length === 0 && (
                  <tr><td colSpan={11} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin productos</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB KARDEX ── */}
      {tab === 'kardex' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Producto</th><th>Tipo</th><th>Cantidad</th>
                <th>Stock Antes</th><th>Stock Después</th><th>Referencia</th><th>Motivo</th>
              </tr></thead>
              <tbody>
                {movimientos.slice(0, 100).map(m => {
                  const tipoColor: Record<string, string> = {
                    entrada: 'var(--green)', salida: 'var(--red)',
                    ajuste: 'var(--amber)', muestra: 'var(--purple)',
                  }
                  return (
                    <tr key={m.id}>
                      <td className="mono" style={{ fontSize: 11 }}>{m.fecha}</td>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{(m.producto as unknown as { nombre: string })?.nombre ?? '–'}</td>
                      <td>
                        <span className="badge" style={{ background: (tipoColor[m.tipo] ?? 'var(--teal)') + '22', color: tipoColor[m.tipo] ?? 'var(--teal)', border: `1px solid ${(tipoColor[m.tipo] ?? 'var(--teal)')}44` }}>
                          {m.tipo}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{m.cantidad}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--txt3)' }}>{(m as unknown as { stock_antes?: number }).stock_antes ?? '–'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{(m as unknown as { stock_despues?: number }).stock_despues ?? '–'}</td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{m.referencia ?? '–'}</td>
                      <td style={{ fontSize: 11 }}>{m.notas ?? (m as unknown as { motivo?: string }).motivo ?? '–'}</td>
                    </tr>
                  )
                })}
                {movimientos.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin movimientos registrados</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB LOTES ── */}
      {tab === 'lotes' && (
        <LotesTab
          lotes={lotes}
          productos={productos.filter(p => p.activo !== false)}
          kpis={lotesKpis}
          hoy={hoy}
          en30s={en30s}
          en60s={en60s}
        />
      )}

      {tab === 'precios' && (
        <PreciosHistorialTab
          productos={productos.filter(p => p.activo !== false).map(p => ({ id: p.id, nombre: p.nombre, codigo: p.codigo }))}
        />
      )}

      {showProd && <ProductoModal edit={editProd} onClose={() => { setShowProd(false); setEditProd(null) }} onSaved={() => { setShowProd(false); setEditProd(null); reload() }} />}
      {showMov  && <MovimientoModal productos={productos.filter(p => p.activo !== false)} onClose={() => setShowMov(false)} onSaved={() => { setShowMov(false); reload() }} />}
    </div>
  )
}

'use client'
import { useState } from 'react'
import { fmtUSD, today } from '@/lib/utils'
import type { Devolucion } from '@/lib/types'

interface VentaDevolvible {
  id: string; numero?: string; nombre: string; fecha: string
  monto: number; cobro: string; devolucion_estado?: string
  items?: {
    id: string; descripcion: string; cantidad: number
    precio_unitario: number; subtotal: number
    producto?: { nombre: string; codigo: string; precio_venta: number } | null
  }[]
}

interface DevKpis { totalMes: number; montoMes: number; totalGeneral: number; montoGeneral: number }

interface Props {
  devoluciones: Devolucion[]
  ventasDevolvibles: VentaDevolvible[]
  kpis: DevKpis
  mesActual: string
}

function DevolucionModal({ ventas, onClose, onSaved }: {
  ventas: VentaDevolvible[]; onClose: () => void; onSaved: () => void
}) {
  const [ventaId,     setVentaId]     = useState('')
  const [fecha,       setFecha]       = useState(today())
  const [tipo,        setTipo]        = useState<'total' | 'parcial'>('total')
  const [motivo,      setMotivo]      = useState('')
  const [generaNC,    setGeneraNC]    = useState(true)
  const [notas,       setNotas]       = useState('')
  const [itemsSel,    setItemsSel]    = useState<Record<string, number>>({}) // venta_item_id → cantidad
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const venta = ventas.find(v => v.id === ventaId)
  const itemsVenta = venta?.items ?? []

  // Al seleccionar venta → si es total, seleccionar todos los items
  function onPickVenta(id: string) {
    setVentaId(id)
    setItemsSel({})
    setTipo('total')
  }

  function onTipoChange(t: 'total' | 'parcial') {
    setTipo(t)
    if (t === 'total') {
      // Seleccionar todos con cantidad completa
      const all: Record<string, number> = {}
      itemsVenta.forEach(i => { all[i.id] = i.cantidad })
      setItemsSel(all)
    } else {
      setItemsSel({})
    }
  }

  // Calcular monto devuelto a partir de items seleccionados
  const montoDevuelto = itemsVenta.reduce((a, item) => {
    const cantDev = itemsSel[item.id] ?? 0
    return a + (cantDev * item.precio_unitario)
  }, 0)

  const itemsPayload = itemsVenta
    .filter(i => (itemsSel[i.id] ?? 0) > 0)
    .map(i => ({
      venta_item_id:   i.id,
      producto_id:     i.producto ? (i.producto as unknown as { id?: string }).id ?? null : null,
      descripcion:     i.descripcion,
      cantidad:        itemsSel[i.id],
      precio_unitario: i.precio_unitario,
      subtotal:        parseFloat((itemsSel[i.id] * i.precio_unitario).toFixed(2)),
    }))

  async function handleSave() {
    if (!ventaId)         return setError('Selecciona una venta')
    if (!itemsPayload.length) return setError('Selecciona al menos un ítem a devolver')
    if (!motivo.trim())   return setError('El motivo es requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/devoluciones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_devolucion',
          venta_id: ventaId, fecha, tipo,
          motivo, genera_nota_credito: generaNC, notas,
          items: itemsPayload,
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
      <div className="modal-box" style={{ maxWidth: 660 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>↩️ Registrar Devolución</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 14 }}>
          {/* Venta a devolver */}
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Venta a devolver <span className="req">*</span></label>
            <select value={ventaId} onChange={e => onPickVenta(e.target.value)}>
              <option value="">— Buscar venta —</option>
              {ventas.map(v => (
                <option key={v.id} value={v.id}>
                  {v.numero ?? v.id.slice(0,8)} · {v.nombre} · {v.fecha} · {fmtUSD(v.monto)}
                  {v.devolucion_estado ? ` [${v.devolucion_estado}]` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Resumen de la venta seleccionada */}
          {venta && (
            <div style={{ gridColumn: 'span 2', background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 20 }}>
                <span>Cliente: <strong>{venta.nombre}</strong></span>
                <span>Monto original: <strong style={{ color: 'var(--teal)' }}>{fmtUSD(venta.monto)}</strong></span>
                <span>Estado cobro: <strong>{venta.cobro}</strong></span>
              </div>
            </div>
          )}

          <div className="field">
            <label>Fecha de devolución</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>

          <div className="field">
            <label>Tipo de devolución</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {(['total', 'parcial'] as const).map(t => (
                <button key={t} onClick={() => onTipoChange(t)}
                  style={{ flex: 1, padding: '8px', borderRadius: 'var(--r)', border: `1px solid ${tipo === t ? 'var(--red)' : 'var(--bdr)'}`, background: tipo === t ? 'rgba(220,38,38,.1)' : 'var(--surf2)', color: tipo === t ? 'var(--red)' : 'var(--txt3)', fontWeight: tipo === t ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
                  {t === 'total' ? '📦 Devolución Total' : '📦 Devolución Parcial'}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Motivo <span className="req">*</span></label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Producto en mal estado, error en pedido, producto vencido..." />
          </div>
        </div>

        {/* Ítems a devolver */}
        {venta && itemsVenta.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>
              Ítems a devolver {tipo === 'total' ? '(todos seleccionados)' : '— indica la cantidad a devolver por ítem'}
            </div>
            <table className="tbl">
              <thead><tr>
                <th>Producto</th><th>Vendido</th><th>Precio unit.</th><th>A devolver</th><th>Subtotal dev.</th>
              </tr></thead>
              <tbody>
                {itemsVenta.map(item => {
                  const cantDev = itemsSel[item.id] ?? 0
                  const subDev  = cantDev * item.precio_unitario
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 600 }}>{item.descripcion}</td>
                      <td className="mono" style={{ textAlign: 'center' }}>{item.cantidad}</td>
                      <td className="mono">{fmtUSD(item.precio_unitario)}</td>
                      <td>
                        <input type="number" min="0" max={item.cantidad}
                          value={cantDev || ''} placeholder="0"
                          onChange={e => {
                            const v = Math.min(item.cantidad, Math.max(0, parseInt(e.target.value) || 0))
                            setItemsSel(prev => ({ ...prev, [item.id]: v }))
                          }}
                          style={{ width: 70, background: 'var(--surf2)', border: `1px solid ${cantDev > 0 ? 'var(--teal)' : 'var(--bdr)'}`, borderRadius: 'var(--r)', padding: '4px 8px', fontSize: 12, color: 'var(--txt)', textAlign: 'center' }}
                        />
                      </td>
                      <td className="mono" style={{ fontWeight: cantDev > 0 ? 700 : 400, color: cantDev > 0 ? 'var(--red)' : 'var(--txt3)' }}>
                        {cantDev > 0 ? fmtUSD(subDev) : '–'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Resumen del monto */}
            {montoDevuelto > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 'var(--r)', padding: '8px 16px', fontSize: 13, fontWeight: 800 }}>
                  Total a devolver: <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>{fmtUSD(montoDevuelto)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Nota de crédito */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={generaNC} onChange={e => setGeneraNC(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--teal)' }} />
            <span>
              <strong>Generar nota de crédito en CxC</strong>
              <span style={{ color: 'var(--txt3)', marginLeft: 6 }}>
                ({venta?.cobro === 'Cobrado' ? 'Abona a la cartera del cliente' : 'Reduce el saldo de CxC pendiente'})
              </span>
            </span>
          </label>
        </div>

        <div className="field" style={{ marginBottom: 14 }}>
          <label>Notas adicionales</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            placeholder="Observaciones sobre la devolución..." />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}
            style={{ background: 'var(--red)', borderColor: 'var(--red)' }}>
            {saving ? '⏳ Procesando...' : '↩️ Procesar Devolución'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function DevolucionesTab({ devoluciones: initialDevs, ventasDevolvibles, kpis, mesActual }: Props) {
  const [devoluciones, setDevoluciones] = useState(initialDevs)
  const [showModal,    setShowModal]    = useState(false)

  async function anularDevolucion(id: string) {
    if (!confirm('¿Anular esta devolución? El inventario y CxC NO se revierten automáticamente.')) return
    await fetch('/api/devoluciones', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'anular_devolucion', id }) })
    setDevoluciones(d => d.map(x => x.id === id ? { ...x, estado: 'Anulada' as const } : x))
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Devoluciones Mes',   value: String(kpis.totalMes),    sub: mesActual,          color: 'var(--amber)'  },
          { label: 'Monto Devuelto Mes', value: fmtUSD(kpis.montoMes),   sub: 'en el período',    color: 'var(--red)'    },
          { label: 'Total Historial',    value: String(kpis.totalGeneral), sub: 'procesadas',      color: 'var(--blue)'   },
          { label: 'Monto Total',        value: fmtUSD(kpis.montoGeneral), sub: 'acumulado',       color: 'var(--purple)' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 18 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary" style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }}
          onClick={() => setShowModal(true)}>
          ↩️ Nueva Devolución
        </button>
      </div>

      {/* Tabla */}
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>#</th><th>Fecha</th><th>Venta original</th><th>Cliente</th>
              <th>Tipo</th><th>Motivo</th><th>Monto dev.</th><th>NC generada</th><th>Estado</th><th>Acción</th>
            </tr></thead>
            <tbody>
              {devoluciones.map(d => {
                const ventaNombre = (d.venta as unknown as { nombre?: string })?.nombre ?? '–'
                const ventaNum    = (d.venta as unknown as { numero?: string })?.numero ?? '–'
                return (
                  <tr key={d.id}>
                    <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{d.numero ?? '–'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{d.fecha}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--txt3)' }}>{ventaNum}</td>
                    <td style={{ fontWeight: 600 }}>{ventaNombre}</td>
                    <td><span className={`badge ${d.tipo === 'total' ? 'badge-red' : 'badge-amber'}`}>{d.tipo}</span></td>
                    <td style={{ fontSize: 11, maxWidth: 160 }}>{d.motivo ?? '–'}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtUSD(d.monto_devuelto)}</td>
                    <td style={{ fontSize: 11 }}>{d.genera_nota_credito ? <span className="badge badge-blue">Sí</span> : <span className="badge badge-gray">No</span>}</td>
                    <td><span className={`badge ${d.estado === 'Procesada' ? 'badge-green' : 'badge-red'}`}>{d.estado}</span></td>
                    <td>
                      {d.estado === 'Procesada' && (
                        <button className="btn btn-danger btn-sm" onClick={() => anularDevolucion(d.id)}>Anular</button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {devoluciones.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>
                  Sin devoluciones registradas.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <DevolucionModal
          ventas={ventasDevolvibles}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); window.location.reload() }}
        />
      )}
    </div>
  )
}

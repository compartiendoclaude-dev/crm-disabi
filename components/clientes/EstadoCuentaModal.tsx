'use client'
import { useState, useEffect } from 'react'
import { fmtUSD } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Linea {
  fecha: string
  tipo: 'venta' | 'abono' | 'devolucion' | 'cxc'
  descripcion: string
  cargo: number
  abono: number
  saldo_acumulado: number
  referencia?: string
  detalle?: { items?: unknown[]; cobro?: string; metodo?: string; notas?: string }
}

interface CxcRow {
  id: string; numero?: string; fecha_emision: string; fecha_vence?: string
  monto: number; saldo: number; estado: string
  abonos?: { id: string; monto: number; fecha: string; notas?: string }[]
}

interface Resumen {
  totalComprado: number; totalPagado: number; totalCredito: number
  saldoPendiente: number; totalDevuelto: number; montoVencido: number
  numVentas: number; numCxc: number; numVencidas: number
}

interface EstadoCuenta {
  cliente: string; resumen: Resumen; cxcs: CxcRow[]; lineas: Linea[]
}

// ─── Badge estado CxC ─────────────────────────────────────────────────────────
function EstBadge({ estado }: { estado: string }) {
  const map: Record<string, [string, string]> = {
    Pendiente: ['#d97706', 'Pendiente'],
    Parcial:   ['#7c3aed', 'Parcial'],
    Vencido:   ['#dc2626', 'Vencido'],
    Pagado:    ['#16a34a', 'Pagado'],
  }
  const [color, label] = map[estado] ?? ['#6b7280', estado]
  return (
    <span style={{ background: color + '22', color, border: `1px solid ${color}44`,
      padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
      {label}
    </span>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function EstadoCuentaModal({
  clienteNombre, onClose,
}: { clienteNombre: string; onClose: () => void }) {
  const [data,     setData]     = useState<EstadoCuenta | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [desde,    setDesde]    = useState('')
  const [hasta,    setHasta]    = useState('')
  const [vista,    setVista]    = useState<'timeline' | 'cxc'>('timeline')
  const [expand,   setExpand]   = useState<string | null>(null)

  async function cargar(d = desde, h = hasta) {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ nombre: clienteNombre })
      if (d) params.set('desde', d)
      if (h) params.set('hasta', h)
      const res = await fetch(`/api/clientes/estado-cuenta?${params}`)
      if (!res.ok) throw new Error((await res.json()).error)
      setData(await res.json())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally { setLoading(false) }
  }

  useEffect(() => { cargar() }, [])  // eslint-disable-line

  function imprimir() { window.print() }

  const r = data?.resumen

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}
      style={{ alignItems: 'flex-start', paddingTop: 20, overflowY: 'auto' }}>
      <div className="modal-box" style={{ maxWidth: 800, width: '95vw', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>📋 Estado de Cuenta</h3>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--teal)' }}>{clienteNombre}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={imprimir}>🖨 Imprimir</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {/* Filtros fecha */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: 'var(--txt3)' }}>Desde</span>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ color: 'var(--txt3)' }}>Hasta</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => cargar(desde, hasta)}>🔍 Filtrar</button>
          {(desde || hasta) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setDesde(''); setHasta(''); cargar('', '') }}>
              ✕ Todo
            </button>
          )}
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
            borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>⏳ Cargando estado de cuenta...</div>
        ) : data && (
          <>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Total comprado',    value: fmtUSD(r!.totalComprado),  color: 'var(--teal)',  sub: `${r!.numVentas} ventas` },
                { label: 'Total pagado',       value: fmtUSD(r!.totalPagado),   color: '#16a34a',      sub: 'efectivo / transferencia' },
                { label: 'Saldo pendiente',    value: fmtUSD(r!.saldoPendiente),color: r!.saldoPendiente > 0 ? '#d97706' : '#16a34a', sub: `${r!.numCxc} CxC` },
                { label: 'Monto vencido',      value: fmtUSD(r!.montoVencido),  color: r!.montoVencido > 0 ? '#dc2626' : '#16a34a',   sub: `${r!.numVencidas} CxC vencida${r!.numVencidas !== 1 ? 's' : ''}` },
                { label: 'Total devoluciones', value: fmtUSD(r!.totalDevuelto), color: 'var(--txt3)',  sub: 'notas de crédito' },
                { label: 'En crédito activo',  value: fmtUSD(r!.totalCredito),  color: '#7c3aed',      sub: 'ventas a crédito' },
              ].map(k => (
                <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
                  <div className="kpi-label">{k.label}</div>
                  <div className="kpi-value" style={{ color: k.color, fontSize: 17 }}>{k.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>
                </div>
              ))}
            </div>

            {/* Alerta vencido */}
            {r!.montoVencido > 0 && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(220,38,38,.08)',
                border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', fontSize: 12, color: '#dc2626' }}>
                ⚠️ Este cliente tiene <strong>{fmtUSD(r!.montoVencido)}</strong> en créditos vencidos
                ({r!.numVencidas} documento{r!.numVencidas !== 1 ? 's' : ''}).
              </div>
            )}

            {/* Vista tabs */}
            <div className="tab-bar" style={{ marginBottom: 16 }}>
              <button className={`tab-btn${vista === 'timeline' ? ' active' : ''}`} onClick={() => setVista('timeline')}>
                📅 Línea de tiempo
              </button>
              <button className={`tab-btn${vista === 'cxc' ? ' active' : ''}`} onClick={() => setVista('cxc')}>
                💳 Créditos y CxC ({data.cxcs.length})
              </button>
            </div>

            {/* ── TIMELINE ── */}
            {vista === 'timeline' && (
              <div className="table-wrap">
                {data.lineas.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
                    Sin movimientos en el período seleccionado
                  </div>
                ) : (
                  <table>
                    <thead><tr>
                      <th>Fecha</th><th>Tipo</th><th>Descripción</th>
                      <th style={{ textAlign: 'right' }}>Cargo</th>
                      <th style={{ textAlign: 'right' }}>Abono</th>
                      <th style={{ textAlign: 'right' }}>Saldo</th>
                    </tr></thead>
                    <tbody>
                      {data.lineas.map((l, i) => {
                        const isExpanded = expand === `${i}`
                        const tipoCfg: Record<string, { icon: string; color: string }> = {
                          venta:      { icon: '💰', color: 'var(--teal)'  },
                          abono:      { icon: '✅', color: '#16a34a'      },
                          devolucion: { icon: '↩️', color: '#7c3aed'      },
                          cxc:        { icon: '📄', color: '#d97706'      },
                        }
                        const tc = tipoCfg[l.tipo] ?? { icon: '•', color: 'var(--txt3)' }
                        return (
                          <>
                            <tr key={i} style={{ cursor: l.detalle ? 'pointer' : 'default' }}
                              onClick={() => l.detalle && setExpand(isExpanded ? null : `${i}`)}>
                              <td className="mono" style={{ fontSize: 11 }}>{l.fecha}</td>
                              <td>
                                <span style={{ fontSize: 10, fontWeight: 700, color: tc.color }}>
                                  {tc.icon} {l.tipo.toUpperCase()}
                                </span>
                              </td>
                              <td style={{ fontSize: 12 }}>
                                {l.descripcion}
                                {l.detalle && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--txt3)' }}>▾</span>}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', color: '#dc2626', fontSize: 12 }}>
                                {l.cargo > 0 ? fmtUSD(l.cargo) : '—'}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', color: '#16a34a', fontSize: 12 }}>
                                {l.abono > 0 ? fmtUSD(l.abono) : '—'}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 700,
                                color: l.saldo_acumulado > 0 ? '#d97706' : '#16a34a', fontSize: 12 }}>
                                {fmtUSD(Math.abs(l.saldo_acumulado))}
                                {l.saldo_acumulado > 0 ? ' D' : ' C'}
                              </td>
                            </tr>
                            {isExpanded && l.detalle && (
                              <tr key={`exp-${i}`}>
                                <td colSpan={6} style={{ background: 'var(--surf2)', padding: '8px 16px' }}>
                                  <div style={{ fontSize: 11, color: 'var(--txt2)' }}>
                                    {l.detalle.cobro && <span style={{ marginRight: 12 }}>Estado: <strong>{l.detalle.cobro}</strong></span>}
                                    {l.detalle.metodo && <span style={{ marginRight: 12 }}>Método: <strong>{l.detalle.metodo}</strong></span>}
                                    {l.detalle.notas && <span>Notas: {l.detalle.notas}</span>}
                                    {Array.isArray(l.detalle.items) && l.detalle.items.length > 0 && (
                                      <div style={{ marginTop: 6 }}>
                                        {(l.detalle.items as { descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }[]).map((it, j) => (
                                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                            <span>{it.descripcion} × {it.cantidad} @ {fmtUSD(it.precio_unitario)}</span>
                                            <span style={{ fontFamily: 'monospace' }}>{fmtUSD(it.subtotal)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--bdr)', background: 'var(--surf2)' }}>
                        <td colSpan={3} style={{ padding: '8px 0', fontWeight: 700, fontSize: 12 }}>TOTALES</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: '#dc2626', fontSize: 12 }}>
                          {fmtUSD(data.lineas.reduce((a, l) => a + l.cargo, 0))}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a', fontSize: 12 }}>
                          {fmtUSD(data.lineas.reduce((a, l) => a + l.abono, 0))}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800,
                          color: r!.saldoPendiente > 0 ? '#d97706' : '#16a34a', fontSize: 13 }}>
                          {fmtUSD(r!.saldoPendiente)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
            )}

            {/* ── CXC ── */}
            {vista === 'cxc' && (
              <div>
                {data.cxcs.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: 'var(--txt3)', fontSize: 13 }}>
                    Sin créditos registrados para este cliente
                  </div>
                ) : (
                  data.cxcs.map(cxc => (
                    <div key={cxc.id} style={{ marginBottom: 14, border: '1px solid var(--bdr)',
                      borderRadius: 'var(--r)', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', background: 'var(--surf2)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: 13, marginRight: 10 }}>
                            {cxc.numero ?? cxc.id.slice(0, 8)}
                          </span>
                          <EstBadge estado={cxc.estado} />
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                          <span>Emisión: <strong>{cxc.fecha_emision}</strong></span>
                          {cxc.fecha_vence && <span>Vence: <strong>{cxc.fecha_vence}</strong></span>}
                          <span>Monto: <strong style={{ fontFamily: 'monospace' }}>{fmtUSD(cxc.monto)}</strong></span>
                          <span>Saldo: <strong style={{ fontFamily: 'monospace', color: cxc.saldo > 0 ? '#d97706' : '#16a34a' }}>{fmtUSD(cxc.saldo)}</strong></span>
                        </div>
                      </div>
                      {/* Abonos */}
                      {(cxc.abonos?.length ?? 0) > 0 && (
                        <div style={{ padding: '6px 14px' }}>
                          <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>Abonos</div>
                          {cxc.abonos!.map(ab => (
                            <div key={ab.id} style={{ display: 'flex', justifyContent: 'space-between',
                              padding: '4px 0', fontSize: 12, borderTop: '1px solid var(--bdr)' }}>
                              <span className="mono" style={{ color: 'var(--txt3)' }}>{ab.fecha}</span>
                              <span>{ab.notas ?? 'Abono'}</span>
                              <span style={{ fontFamily: 'monospace', color: '#16a34a', fontWeight: 700 }}>+{fmtUSD(ab.monto)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

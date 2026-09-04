'use client'
import { useState } from 'react'
import { fmtUSD, diasEntre, today } from '@/lib/utils'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface AlertaStock  { id: string; codigo: string; nombre: string; stock_actual: number; stock_minimo: number }
interface AlertaCxC    { id: string; numero?: string; cliente: string; saldo: number; fecha_vence?: string }
interface AlertaLote   { id: string; numero_lote: string; fecha_vencimiento: string; cantidad_actual: number; producto?: { nombre: string; codigo: string } | null }
interface AlertaPP     { cliente: string; total: number; fecha_entrega: string }

interface AlertasData {
  stockBajo:   AlertaStock[]
  cxcVencidas: AlertaCxC[]
  lotesVencen: AlertaLote[]
  ppSemana:    AlertaPP[]
}

interface Props { alertas: AlertasData }

// ─── Badge de urgencia ────────────────────────────────────────────────────────
function UrgenciaBadge({ dias }: { dias: number }) {
  const color = dias <= 0 ? '#dc2626' : dias <= 7 ? '#d97706' : '#0891b2'
  const label = dias <= 0 ? 'Vencido' : dias === 1 ? 'Mañana' : `${dias}d`
  return (
    <span style={{ background: color + '20', color, border: `1px solid ${color}44`,
      padding: '1px 6px', borderRadius: 99, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// ─── Sección de alerta colapsable ────────────────────────────────────────────
function SeccionAlerta({ icon, titulo, color, count, children }: {
  icon: string; titulo: string; color: string; count: number; children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 'var(--r)',
      overflow: 'hidden', background: `${color}08` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left' }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color, flex: 1 }}>{titulo}</span>
        <span style={{ background: color + '25', color, borderRadius: 99,
          padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>{count}</span>
        <span style={{ fontSize: 11, color, opacity: .7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${color}22`, padding: '10px 14px' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AlertasPanel({ alertas }: Props) {
  const hoy = today()
  const total = alertas.stockBajo.length + alertas.cxcVencidas.length +
                alertas.lotesVencen.length + alertas.ppSemana.length

  if (total === 0) {
    return (
      <div className="card" style={{ borderLeft: '3px solid #16a34a', marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#16a34a' }}>Sin alertas activas</div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
              Stock, créditos, lotes y pagos están todos en orden
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔔</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>Alertas activas</div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
              {total} alerta{total !== 1 ? 's' : ''} requieren atención
            </div>
          </div>
        </div>
        {/* Resumen de chips */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {alertas.cxcVencidas.length > 0 && (
            <span style={{ background: 'rgba(220,38,38,.15)', color: '#dc2626',
              padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
              💳 {alertas.cxcVencidas.length} CxC vencida{alertas.cxcVencidas.length !== 1 ? 's' : ''}
            </span>
          )}
          {alertas.stockBajo.length > 0 && (
            <span style={{ background: 'rgba(217,119,6,.15)', color: '#d97706',
              padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
              📦 {alertas.stockBajo.length} stock bajo
            </span>
          )}
          {alertas.lotesVencen.length > 0 && (
            <span style={{ background: 'rgba(109,40,217,.12)', color: '#7c3aed',
              padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
              ⏳ {alertas.lotesVencen.length} lote{alertas.lotesVencen.length !== 1 ? 's' : ''} por vencer
            </span>
          )}
          {alertas.ppSemana.length > 0 && (
            <span style={{ background: 'rgba(8,145,178,.12)', color: '#0891b2',
              padding: '3px 8px', borderRadius: 99, fontSize: 11, fontWeight: 700 }}>
              📅 {alertas.ppSemana.length} PP esta semana
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* CxC VENCIDAS — mayor urgencia */}
        {alertas.cxcVencidas.length > 0 && (
          <SeccionAlerta icon="💳" titulo="Créditos vencidos (CxC)" color="#dc2626" count={alertas.cxcVencidas.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alertas.cxcVencidas.map((c) => {
                const diasVencido = c.fecha_vence ? diasEntre(c.fecha_vence, hoy) : 0
                return (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: 'rgba(220,38,38,.06)', borderRadius: 6,
                    borderLeft: '3px solid #dc2626' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.cliente}</div>
                      <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 1 }}>
                        {c.numero ?? c.id.slice(0,8)}
                        {c.fecha_vence ? ` · Venció ${c.fecha_vence}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {diasVencido > 0 && (
                        <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 700 }}>
                          {diasVencido}d vencido
                        </span>
                      )}
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#dc2626', fontSize: 14 }}>
                        {fmtUSD(c.saldo)}
                      </span>
                    </div>
                  </div>
                )
              })}
              <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4, fontWeight: 700 }}>
                Total vencido: {fmtUSD(alertas.cxcVencidas.reduce((a, c) => a + c.saldo, 0))}
              </div>
            </div>
          </SeccionAlerta>
        )}

        {/* PP QUE VENCEN ESTA SEMANA */}
        {alertas.ppSemana.length > 0 && (
          <SeccionAlerta icon="📅" titulo="Pagos pendientes que vencen esta semana" color="#0891b2" count={alertas.ppSemana.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alertas.ppSemana.map((pp, i) => {
                const dias = diasEntre(hoy, pp.fecha_entrega)
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: 'rgba(8,145,178,.06)', borderRadius: 6,
                    borderLeft: '3px solid #0891b2' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{pp.cliente}</div>
                      <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 1 }}>
                        Vence {pp.fecha_entrega}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <UrgenciaBadge dias={dias} />
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0891b2', fontSize: 14 }}>
                        {fmtUSD(pp.total)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </SeccionAlerta>
        )}

        {/* STOCK BAJO */}
        {alertas.stockBajo.length > 0 && (
          <SeccionAlerta icon="📦" titulo="Productos bajo stock mínimo" color="#d97706" count={alertas.stockBajo.length}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
              {alertas.stockBajo.map(p => {
                const pct = p.stock_minimo > 0 ? Math.round(p.stock_actual / p.stock_minimo * 100) : 0
                return (
                  <div key={p.id} style={{ padding: '8px 10px', background: 'rgba(217,119,6,.06)',
                    borderRadius: 6, borderLeft: '3px solid #d97706' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nombre}</div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'monospace' }}>{p.codigo}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 15, color: '#d97706', fontFamily: 'monospace' }}>
                          {p.stock_actual}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                          mín: {p.stock_minimo}
                        </div>
                      </div>
                    </div>
                    {/* Mini barra de stock */}
                    <div style={{ height: 4, background: 'rgba(217,119,6,.2)', borderRadius: 99, marginTop: 6 }}>
                      <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`,
                        background: pct === 0 ? '#dc2626' : '#d97706', borderRadius: 99 }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 2, textAlign: 'right' }}>
                      {pct}% del mínimo
                    </div>
                  </div>
                )
              })}
            </div>
          </SeccionAlerta>
        )}

        {/* LOTES POR VENCER */}
        {alertas.lotesVencen.length > 0 && (
          <SeccionAlerta icon="⏳" titulo="Lotes próximos a vencer (30 días)" color="#7c3aed" count={alertas.lotesVencen.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alertas.lotesVencen.map(l => {
                const dias = diasEntre(hoy, l.fecha_vencimiento)
                return (
                  <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: 'rgba(109,40,217,.06)', borderRadius: 6,
                    borderLeft: `3px solid ${dias <= 7 ? '#dc2626' : '#7c3aed'}` }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {l.producto?.nombre ?? 'Producto desconocido'}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 1, fontFamily: 'monospace' }}>
                        Lote {l.numero_lote} · {l.cantidad_actual} unidades
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{l.fecha_vencimiento}</div>
                        <UrgenciaBadge dias={dias} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </SeccionAlerta>
        )}

      </div>
    </div>
  )
}

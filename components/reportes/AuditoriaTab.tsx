'use client'
import { useState, useEffect, useCallback } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface RegistroAuditoria {
  id: string
  tabla: string
  operacion: 'INSERT' | 'UPDATE' | 'DELETE'
  registro_id?: string
  usuario_email?: string
  datos_antes?: Record<string, unknown>
  datos_despues?: Record<string, unknown>
  created_at: string
}

interface AuditoriaResponse {
  registros: RegistroAuditoria[]
  total: number
  page: number
  limit: number
  tablas: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function OpBadge({ op }: { op: string }) {
  const cfg: Record<string, [string, string]> = {
    INSERT: ['#16a34a', 'INSERT'],
    UPDATE: ['#d97706', 'UPDATE'],
    DELETE: ['#dc2626', 'DELETE'],
  }
  const [color, label] = cfg[op] ?? ['#6b7280', op]
  return (
    <span style={{ background: color + '20', color, border: `1px solid ${color}44`,
      padding: '2px 7px', borderRadius: 99, fontSize: 10, fontWeight: 800, fontFamily: 'monospace' }}>
      {label}
    </span>
  )
}

function TablaChip({ tabla }: { tabla: string }) {
  const color = tabla.includes('ventas') ? '#0891b2'
    : tabla.includes('cxc')     ? '#7c3aed'
    : tabla.includes('gastos')  ? '#dc2626'
    : tabla.includes('planilla') || tabla.includes('comision') ? '#d97706'
    : '#6b7280'
  return (
    <span style={{ background: color + '18', color, padding: '2px 7px',
      borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}>
      {tabla.replace('disabi_', '')}
    </span>
  )
}

// ─── Modal de detalle de cambio ───────────────────────────────────────────────
function DetalleModal({ registro, onClose }: { registro: RegistroAuditoria; onClose: () => void }) {
  // Calcular campos que cambiaron en UPDATE
  const cambios: { campo: string; antes: unknown; despues: unknown }[] = []
  if (registro.operacion === 'UPDATE' && registro.datos_antes && registro.datos_despues) {
    for (const key of Object.keys(registro.datos_despues)) {
      const antes   = registro.datos_antes[key]
      const despues = registro.datos_despues[key]
      if (JSON.stringify(antes) !== JSON.stringify(despues)) {
        cambios.push({ campo: key, antes, despues })
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🔍 Detalle de auditoría</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <OpBadge op={registro.operacion} />
              <TablaChip tabla={registro.tabla} />
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>

        {/* Meta */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16, fontSize: 12 }}>
          {[
            { label: 'Usuario',     value: registro.usuario_email ?? 'Sistema' },
            { label: 'Fecha/Hora',  value: registro.created_at.replace('T', ' ').slice(0, 19) },
            { label: 'Tabla',       value: registro.tabla },
            { label: 'Registro ID', value: registro.registro_id ?? '—' },
          ].map(f => (
            <div key={f.label} style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '8px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all' }}>{f.value}</div>
            </div>
          ))}
        </div>

        {/* Campos cambiados (UPDATE) */}
        {registro.operacion === 'UPDATE' && cambios.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase',
              marginBottom: 8, letterSpacing: '.4px' }}>Campos modificados ({cambios.length})</div>
            <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: 'var(--surf2)',
                padding: '6px 12px', fontSize: 10, fontWeight: 700, color: 'var(--txt3)',
                textTransform: 'uppercase', gap: 8 }}>
                <span>Campo</span><span>Antes</span><span>Después</span>
              </div>
              {cambios.map((c, i) => (
                <div key={c.campo} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                  padding: '7px 12px', fontSize: 11, borderTop: i > 0 ? '1px solid var(--bdr)' : 'none',
                  alignItems: 'start' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--teal)', fontWeight: 600 }}>{c.campo}</span>
                  <span style={{ fontFamily: 'monospace', color: '#dc2626', wordBreak: 'break-all' }}>
                    {c.antes === null || c.antes === undefined ? <em style={{ opacity: .5 }}>null</em> : String(c.antes)}
                  </span>
                  <span style={{ fontFamily: 'monospace', color: '#16a34a', wordBreak: 'break-all' }}>
                    {c.despues === null || c.despues === undefined ? <em style={{ opacity: .5 }}>null</em> : String(c.despues)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* JSON completo colapsable */}
        {(registro.datos_antes || registro.datos_despues) && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--txt3)', marginBottom: 8 }}>
              Ver JSON completo
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: registro.datos_antes && registro.datos_despues ? '1fr 1fr' : '1fr', gap: 10 }}>
              {registro.datos_antes && (
                <div>
                  <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, marginBottom: 4 }}>ANTES</div>
                  <pre style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 10,
                    fontSize: 9, overflow: 'auto', maxHeight: 200, border: '1px solid var(--bdr)',
                    color: 'var(--txt2)', margin: 0 }}>
                    {JSON.stringify(registro.datos_antes, null, 2)}
                  </pre>
                </div>
              )}
              {registro.datos_despues && (
                <div>
                  <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 700, marginBottom: 4 }}>DESPUÉS</div>
                  <pre style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 10,
                    fontSize: 9, overflow: 'auto', maxHeight: 200, border: '1px solid var(--bdr)',
                    color: 'var(--txt2)', margin: 0 }}>
                    {JSON.stringify(registro.datos_despues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AuditoriaTab() {
  const [data,       setData]       = useState<AuditoriaResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [detalle,    setDetalle]    = useState<RegistroAuditoria | null>(null)
  const [page,       setPage]       = useState(1)

  // Filtros
  const [tabla,      setTabla]      = useState('')
  const [operacion,  setOperacion]  = useState('')
  const [usuario,    setUsuario]    = useState('')
  const [desde,      setDesde]      = useState('')
  const [hasta,      setHasta]      = useState('')

  const cargar = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' })
      if (tabla)     params.set('tabla', tabla)
      if (operacion) params.set('operacion', operacion)
      if (usuario)   params.set('usuario', usuario)
      if (desde)     params.set('desde', desde)
      if (hasta)     params.set('hasta', hasta)
      const res = await fetch(`/api/auditoria?${params}`)
      if (res.ok) setData(await res.json())
    } finally { setLoading(false) }
  }, [tabla, operacion, usuario, desde, hasta, page])

  useEffect(() => { cargar(1); setPage(1) }, [tabla, operacion, usuario, desde, hasta]) // eslint-disable-line
  useEffect(() => { cargar(page) }, [page]) // eslint-disable-line

  const totalPages = data ? Math.ceil(data.total / data.limit) : 0

  // Nombre corto de usuario
  function shortEmail(email?: string) {
    if (!email) return 'Sistema'
    const local = email.split('@')[0]
    return local.charAt(0).toUpperCase() + local.slice(1)
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={tabla} onChange={e => setTabla(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
          <option value="">Todas las tablas</option>
          {(data?.tablas ?? []).map(t => (
            <option key={t} value={t}>{t.replace('disabi_', '')}</option>
          ))}
        </select>

        <select value={operacion} onChange={e => setOperacion(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
          <option value="">Todas las operaciones</option>
          <option value="INSERT">INSERT (nuevo)</option>
          <option value="UPDATE">UPDATE (modificado)</option>
          <option value="DELETE">DELETE (eliminado)</option>
        </select>

        <input value={usuario} onChange={e => setUsuario(e.target.value)}
          placeholder="🔍 Buscar usuario..."
          style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 12, width: 160 }} />

        <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
          style={{ padding: '7px 8px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }} />
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>→</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
          style={{ padding: '7px 8px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
            background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }} />

        {(tabla || operacion || usuario || desde || hasta) && (
          <button className="btn btn-secondary btn-sm"
            onClick={() => { setTabla(''); setOperacion(''); setUsuario(''); setDesde(''); setHasta('') }}>
            ✕ Limpiar
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--txt3)' }}>
          {data?.total.toLocaleString() ?? '—'} registros
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>⏳ Cargando auditoría...</div>
      ) : !data || data.registros.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--txt3)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {data?.total === 0 && !tabla && !operacion
              ? 'Sin registros de auditoría aún'
              : 'Sin resultados con estos filtros'}
          </div>
          <div style={{ fontSize: 12 }}>
            {data?.total === 0 && !tabla && !operacion
              ? 'Los registros aparecerán aquí automáticamente cuando se realicen operaciones en el sistema'
              : 'Prueba ajustando los filtros'}
          </div>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Fecha / Hora</th>
                <th>Operación</th>
                <th>Tabla</th>
                <th>Usuario</th>
                <th>ID Registro</th>
                <th>Resumen</th>
                <th></th>
              </tr></thead>
              <tbody>
                {data.registros.map(r => {
                  // Resumen inteligente del cambio
                  let resumen = ''
                  if (r.operacion === 'INSERT' && r.datos_despues) {
                    const d = r.datos_despues
                    resumen = (d.nombre ?? d.cliente ?? d.descripcion ?? d.numero ?? '').toString().slice(0, 40)
                  } else if (r.operacion === 'UPDATE' && r.datos_antes && r.datos_despues) {
                    const campos = Object.keys(r.datos_despues).filter(k =>
                      JSON.stringify(r.datos_antes![k]) !== JSON.stringify(r.datos_despues![k])
                    )
                    resumen = campos.slice(0, 3).join(', ') + (campos.length > 3 ? ` +${campos.length - 3}` : '')
                  } else if (r.operacion === 'DELETE' && r.datos_antes) {
                    const d = r.datos_antes
                    resumen = (d.nombre ?? d.cliente ?? d.descripcion ?? d.numero ?? '').toString().slice(0, 40)
                  }

                  return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(r)}>
                      <td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                        {r.created_at.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td><OpBadge op={r.operacion} /></td>
                      <td><TablaChip tabla={r.tabla} /></td>
                      <td style={{ fontSize: 12 }}>
                        <div style={{ fontWeight: 600 }}>{shortEmail(r.usuario_email)}</div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{r.usuario_email ?? '—'}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)', maxWidth: 100,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.registro_id?.slice(0, 8) ?? '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--txt2)', maxWidth: 200,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {resumen || '—'}
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); setDetalle(r) }}>
                          👁
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                ← Anterior
              </button>
              <span style={{ fontSize: 12, color: 'var(--txt3)' }}>
                Página {page} de {totalPages} · {data.total.toLocaleString()} registros
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Siguiente →
              </button>
            </div>
          )}
        </>
      )}

      {detalle && <DetalleModal registro={detalle} onClose={() => setDetalle(null)} />}
    </div>
  )
}

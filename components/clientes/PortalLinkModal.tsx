'use client'
import { useState } from 'react'

interface Acceso { ip: string; user_agent: string; accessed_at: string }

export default function PortalLinkModal({
  clienteId, clienteNombre, onClose,
}: { clienteId: string; clienteNombre: string; onClose: () => void }) {
  const [token,       setToken]       = useState('')
  const [expiraAt,    setExpiraAt]    = useState('')
  const [diasValidez, setDiasValidez] = useState(30)
  const [loading,     setLoading]     = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [error,       setError]       = useState('')
  const [accesos,     setAccesos]     = useState<Acceso[] | null>(null)
  const [loadingLog,  setLoadingLog]  = useState(false)

  const portalUrl = token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/portal?token=${token}`
    : ''

  async function generar() {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/portal-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generar_token', cliente_id: clienteId, dias_validez: diasValidez }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setToken(data.token)
      setExpiraAt(data.expira_at)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al generar')
    } finally { setLoading(false) }
  }

  async function copiar() {
    await navigator.clipboard.writeText(portalUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function verLog() {
    setLoadingLog(true)
    try {
      const res = await fetch('/api/portal-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_accesos', cliente_id: clienteId, limit: 10 }),
      })
      const data = await res.json()
      setAccesos(data.accesos ?? [])
    } finally { setLoadingLog(false) }
  }

  function abrirWhatsApp() {
    const fechaExp = expiraAt
      ? new Date(expiraAt).toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' })
      : ''
    const msg = encodeURIComponent(
      `Hola ${clienteNombre}, te comparto el link de tu portal de cliente DISABI donde puedes ver tu estado de cuenta, facturas pendientes y documentos:\n\n${portalUrl}\n\n${fechaExp ? `⚠️ Este link vence el ${fechaExp}.\n\n` : ''}Cualquier consulta estamos disponibles. WhatsApp: +503 7872-0003`
    )
    window.open(`https://wa.me/?text=${msg}`, '_blank')
  }

  function fmtExpira(iso: string) {
    return new Date(iso).toLocaleDateString('es-SV', {
      day: 'numeric', month: 'long', year: 'numeric'
    })
  }

  function fmtAcceso(iso: string) {
    return new Date(iso).toLocaleString('es-SV', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Detectar tipo de dispositivo desde user-agent
  function deviceIcon(ua: string) {
    if (!ua) return '🖥️'
    const u = ua.toLowerCase()
    if (u.includes('mobile') || u.includes('android') || u.includes('iphone')) return '📱'
    if (u.includes('tablet') || u.includes('ipad')) return '📲'
    return '🖥️'
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 500 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>🔗 Portal de cliente</h3>
            <div style={{ fontSize: 12, color: 'var(--txt3)' }}>{clienteNombre}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--txt3)' }}>✕</button>
        </div>

        {/* Descripción */}
        <div style={{ fontSize: 12, color: 'var(--txt2)', marginBottom: 16, lineHeight: 1.6,
          background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 12 }}>
          Vista de solo lectura con estado de cuenta, créditos pendientes, historial de compras y DTE. El link es único y personal para este cliente.
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,.1)', borderRadius: 'var(--r)', padding: '8px 12px',
            fontSize: 12, color: 'var(--red)', marginBottom: 14 }}>{error}</div>
        )}

        {!token ? (
          /* ── Configuración antes de generar ── */
          <div>
            <div className="field" style={{ marginBottom: 16 }}>
              <label>Validez del link</label>
              <select value={diasValidez} onChange={e => setDiasValidez(parseInt(e.target.value))}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 'var(--r)',
                  border: '1px solid var(--bdr)', background: 'var(--surf)', color: 'var(--txt)', fontSize: 13 }}>
                <option value={7}>7 días</option>
                <option value={15}>15 días</option>
                <option value={30}>30 días (recomendado)</option>
                <option value={60}>60 días</option>
                <option value={90}>90 días</option>
              </select>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>
                El link expirará automáticamente. Puedes generar uno nuevo en cualquier momento.
              </div>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={generar} disabled={loading}>
              {loading ? '⏳ Generando...' : '🔑 Generar link de acceso'}
            </button>

            {/* Botón ver log (aunque no hay token nuevo) */}
            <button onClick={verLog} disabled={loadingLog}
              style={{ width: '100%', marginTop: 10, background: 'none', border: 'none',
                color: 'var(--txt3)', fontSize: 12, cursor: 'pointer', padding: '6px 0' }}>
              {loadingLog ? '⏳ Cargando...' : '📋 Ver historial de accesos'}
            </button>
          </div>
        ) : (
          /* ── Token generado ── */
          <div>
            {/* Expiración */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              padding: '8px 12px', background: 'rgba(22,163,74,.08)', borderRadius: 'var(--r)',
              border: '1px solid rgba(22,163,74,.25)' }}>
              <span style={{ fontSize: 14 }}>🔒</span>
              <div style={{ fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: '#16a34a' }}>Link seguro generado</span>
                {expiraAt && (
                  <span style={{ color: 'var(--txt3)', marginLeft: 6 }}>
                    · Vence el <strong style={{ color: 'var(--txt2)' }}>{fmtExpira(expiraAt)}</strong>
                  </span>
                )}
              </div>
            </div>

            {/* URL */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase',
                marginBottom: 6 }}>Link de acceso</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1, padding: '8px 10px', background: 'var(--surf2)', borderRadius: 'var(--r)',
                  border: '1px solid var(--bdr)', fontSize: 11, fontFamily: 'monospace', color: 'var(--teal)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {portalUrl}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={copiar} style={{ flexShrink: 0 }}>
                  {copied ? '✅' : '📋'}
                </button>
              </div>
            </div>

            {/* Acciones */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={abrirWhatsApp}
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--r)', border: 'none',
                  background: '#25d366', color: '#ffffff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                💬 Enviar por WhatsApp
              </button>
              <button onClick={() => window.open(portalUrl, '_blank')} className="btn btn-secondary" style={{ width: '100%' }}>
                👁 Ver portal como cliente
              </button>
            </div>

            {/* Regenerar */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--bdr)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button onClick={generar} disabled={loading}
                style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 12,
                  cursor: 'pointer', padding: 0 }}>
                🔄 Regenerar link (invalida el anterior)
              </button>
              <button onClick={verLog} disabled={loadingLog}
                style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 12,
                  cursor: 'pointer', padding: 0 }}>
                {loadingLog ? '⏳' : '📋 Ver accesos'}
              </button>
            </div>
          </div>
        )}

        {/* Log de accesos */}
        {accesos !== null && (
          <div style={{ marginTop: 16, borderTop: '1px solid var(--bdr)', paddingTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: 'var(--txt2)' }}>
              📋 Últimos accesos al portal
            </div>
            {accesos.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--txt3)', textAlign: 'center', padding: '12px 0' }}>
                Sin accesos registrados todavía
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {accesos.map((a, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: 'var(--surf2)', borderRadius: 'var(--r)', fontSize: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{deviceIcon(a.user_agent)}</span>
                      <div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--txt2)' }}>{a.ip}</div>
                        <div style={{ fontSize: 10, color: 'var(--txt3)', maxWidth: 220,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.user_agent || '—'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontFamily: 'monospace', color: 'var(--txt3)', fontSize: 10, flexShrink: 0 }}>
                      {fmtAcceso(a.accessed_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

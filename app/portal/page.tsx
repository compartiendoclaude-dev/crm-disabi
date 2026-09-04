import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// ─── Helpers inline ───────────────────────────────────────────────────────────
function fmtUSD(n: number) {
  return '$' + (n ?? 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const TIPO_DTE: Record<string, string> = {
  '01': 'Factura (FCF)', '03': 'Crédito Fiscal', '05': 'Nota de Crédito',
  '06': 'Nota de Débito', '07': 'Comp. Retención',
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function PortalClientePage({
  searchParams,
  // req available via headers() in Next.js App Router
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  // Get request headers for IP/UA logging
  const { headers } = await import('next/headers')
  const headersList = await headers()
  const req = { headers: { get: (k: string) => headersList.get(k) } }

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8 }}>Acceso requerido</div>
          <div style={{ color: '#64748b', fontSize: 14 }}>
            Solicita tu link de acceso a DISABI para ver tu estado de cuenta
          </div>
        </div>
      </div>
    )
  }

  // Validar token y obtener datos — usando Supabase directamente (server)
  const sb = await createClient()

  // Obtener IP y user-agent del request
  const ip = req.headers?.get?.('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const ua = req.headers?.get?.('user-agent') ?? ''

  const { data: tokenRow } = await sb.from('disabi_portal_tokens')
    .select('id, cliente_id, expira_at, activo, cliente:disabi_clientes(id, nombre, email, telefono, sector)')
    .eq('token', token)
    .eq('activo', true)
    .single()

  // Token no existe o inactivo
  if (!tokenRow) return notFound()

  // Token expirado — mostrar página de error amigable
  const expira = tokenRow.expira_at ? new Date(tokenRow.expira_at) : null
  if (expira && expira < new Date()) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: 40, maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏰</div>
          <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 8, color: '#0f172a' }}>Link expirado</div>
          <div style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
            Este link venció el {expira.toLocaleDateString('es-SV')}.
            Contacta a DISABI para recibir un nuevo link de acceso.
          </div>
          <div style={{ marginTop: 20, padding: '12px 16px', background: '#f1f5f9', borderRadius: 8,
            fontSize: 13, color: '#475569' }}>
            💬 WhatsApp: +503 7872-0003
          </div>
        </div>
      </div>
    )
  }

  // Registrar acceso (fire-and-forget)
  sb.from('disabi_portal_accesos').insert([{
    token_id:   tokenRow.id,
    cliente_id: tokenRow.cliente_id,
    ip,
    user_agent: ua.slice(0, 300),
  }]).then(() => {/* ignorar */})

  // Actualizar último acceso
  sb.from('disabi_portal_tokens')
    .update({ ultimo_acceso: new Date().toISOString() })
    .eq('id', tokenRow.id)
    .then(() => {/* fire-and-forget */})

  const cliente = tokenRow.cliente as unknown as { id: string; nombre: string; email?: string; telefono?: string; sector?: string }
  const nombre  = cliente.nombre

  // Cargar datos
  const [
    { data: ventas },
    { data: cxcs },
    { data: dtes },
  ] = await Promise.all([
    sb.from('disabi_ventas')
      .select('id, numero, fecha, monto, cobro, metodo_pago, items:disabi_venta_items(descripcion, cantidad, precio_unitario, subtotal)')
      .ilike('nombre', nombre)
      .neq('cobro', 'Borrador')
      .order('fecha', { ascending: false })
      .limit(50),

    sb.from('disabi_cxc')
      .select('id, numero, fecha_emision, fecha_vence, monto, saldo, estado, abonos:disabi_cxc_abonos(monto, fecha, notas)')
      .ilike('cliente', nombre)
      .order('fecha_emision', { ascending: false })
      .limit(20),

    sb.from('disabi_dte')
      .select('id, tipo_dte, numero_control, fecha_emision, total_pagar, estado, sello_recepcion')
      .ilike('receptor_nombre', nombre)
      .order('fecha_emision', { ascending: false })
      .limit(30),
  ])

  const vts     = ventas ?? []
  const cxcRows = cxcs ?? []
  const dteRows = dtes ?? []

  const totalComprado  = vts.reduce((a, v) => a + (v.monto ?? 0), 0)
  const saldoPendiente = cxcRows.filter(c => c.estado !== 'Pagado').reduce((a, c) => a + ((c as { saldo: number }).saldo ?? 0), 0)
  const montoVencido   = cxcRows.filter(c => c.estado === 'Vencido').reduce((a, c) => a + ((c as { saldo: number }).saldo ?? 0), 0)

  const hoy = new Date().toISOString().slice(0, 10)

  // ── Estilos inline (portal es página pública sin globals.css del ERP) ────────
  const card: React.CSSProperties = {
    background: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0',
    padding: 20, marginBottom: 20,
  }
  const th: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11,
    color: '#64748b', fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '.4px', borderBottom: '1px solid #e2e8f0',
    background: '#f8fafc',
  }
  const td: React.CSSProperties = {
    padding: '10px 12px', fontSize: 12, borderBottom: '1px solid #f1f5f9',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#0f172a', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#ffffff', fontWeight: 800, fontSize: 18 }}>📦 DISABI</div>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>Portal de Cliente</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 14 }}>{cliente.nombre}</div>
          {cliente.sector && <div style={{ color: '#94a3b8', fontSize: 11 }}>{cliente.sector}</div>}
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>

        {/* Alerta vencido */}
        {montoVencido > 0 && (
          <div style={{ ...card, borderLeft: '4px solid #dc2626', background: '#fef2f2', marginBottom: 20 }}>
            <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 14 }}>
              ⚠️ Tiene {fmtUSD(montoVencido)} en créditos vencidos
            </div>
            <div style={{ color: '#7f1d1d', fontSize: 12, marginTop: 4 }}>
              Por favor contáctenos para regularizar su cuenta · WhatsApp: +503 7872-0003
            </div>
          </div>
        )}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Total comprado', value: fmtUSD(totalComprado), color: '#0891b2', sub: `${vts.length} facturas` },
            { label: 'Saldo pendiente', value: fmtUSD(saldoPendiente), color: saldoPendiente > 0 ? '#d97706' : '#16a34a', sub: 'crédito activo' },
            { label: 'Documentos DTE', value: String(dteRows.length), color: '#7c3aed', sub: 'facturas electrónicas' },
          ].map(k => (
            <div key={k.label} style={{ ...card, marginBottom: 0, borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* CxC pendientes */}
        {cxcRows.filter(c => c.estado !== 'Pagado').length > 0 && (
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>💳 Créditos Pendientes</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Número', 'Fecha emisión', 'Vence', 'Monto', 'Saldo', 'Estado'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {cxcRows.filter(c => c.estado !== 'Pagado').map(c => {
                    const vencido = c.estado === 'Vencido'
                    const proxVencer = c.fecha_vence && c.fecha_vence <= new Date(Date.now() + 7*86400000).toISOString().slice(0,10) && c.fecha_vence >= hoy
                    return (
                      <tr key={c.id}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{c.numero ?? c.id.slice(0, 8)}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{c.fecha_emision}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11,
                          color: vencido ? '#dc2626' : proxVencer ? '#d97706' : '#475569' }}>
                          {c.fecha_vence ?? '—'}
                        </td>
                        <td style={{ ...td, fontFamily: 'monospace', textAlign: 'right' }}>{fmtUSD(c.monto)}</td>
                        <td style={{ ...td, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700,
                          color: vencido ? '#dc2626' : '#d97706' }}>{fmtUSD((c as { saldo: number }).saldo)}</td>
                        <td style={td}>
                          <span style={{ background: vencido ? '#fef2f2' : '#fffbeb',
                            color: vencido ? '#dc2626' : '#d97706',
                            padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                            {c.estado}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* DTE */}
        {dteRows.length > 0 && (
          <div style={card}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>🧾 Documentos Tributarios Electrónicos</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Tipo', 'Número Control', 'Fecha', 'Total', 'Estado'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {dteRows.map(d => (
                    <tr key={d.id}>
                      <td style={td}>
                        <span style={{ fontSize: 11, fontWeight: 600 }}>{TIPO_DTE[d.tipo_dte] ?? d.tipo_dte}</span>
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>
                        {d.numero_control}
                      </td>
                      <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{d.fecha_emision}</td>
                      <td style={{ ...td, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: '#0891b2' }}>
                        {fmtUSD(d.total_pagar)}
                      </td>
                      <td style={td}>
                        <span style={{ background: d.sello_recepcion ? '#f0fdf4' : '#f8fafc',
                          color: d.sello_recepcion ? '#16a34a' : '#64748b',
                          padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                          {d.sello_recepcion ? '✓ Sellado MH' : d.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Historial de compras */}
        <div style={card}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📄 Historial de Compras</div>
          {vts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 13 }}>Sin compras registradas</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['Número', 'Fecha', 'Total', 'Método', 'Estado'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {vts.map(v => {
                    const estadoColor: Record<string, string> = {
                      Cobrado: '#16a34a', Pendiente: '#d97706',
                      Liquidacion_Pendiente: '#0891b2', Parcial: '#7c3aed',
                    }
                    const estadoLabel: Record<string, string> = {
                      Cobrado: 'Pagado', Pendiente: 'Crédito',
                      Liquidacion_Pendiente: 'En liquidación', Parcial: 'Parcial',
                    }
                    return (
                      <tr key={v.id}>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{v.numero ?? v.id.slice(0, 8)}</td>
                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{v.fecha}</td>
                        <td style={{ ...td, fontFamily: 'monospace', textAlign: 'right', fontWeight: 700, color: '#0891b2' }}>
                          {fmtUSD(v.monto)}
                        </td>
                        <td style={{ ...td, fontSize: 11, color: '#475569' }}>{v.metodo_pago ?? '—'}</td>
                        <td style={td}>
                          <span style={{ background: (estadoColor[v.cobro] ?? '#64748b') + '20',
                            color: estadoColor[v.cobro] ?? '#64748b',
                            padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700 }}>
                            {estadoLabel[v.cobro] ?? v.cobro}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 11 }}>
          <div>DISABI S.A. de C.V. · Distribuidora ROJ Syrups El Salvador</div>
          <div style={{ marginTop: 4 }}>WhatsApp: +503 7872-0003 · Portal generado el {hoy}</div>
          {tokenRow.expira_at && (
            <div style={{ marginTop: 4, color: '#cbd5e1' }}>
              🔒 Este link es personal y vence el {new Date(tokenRow.expira_at).toLocaleDateString('es-SV')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

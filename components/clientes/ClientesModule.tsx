'use client'
import { useState } from 'react'
import EstadoCuentaModal from './EstadoCuentaModal'
import PortalLinkModal from './PortalLinkModal'
import { today } from '@/lib/utils'
import { SECTORES } from '@/lib/constants'

interface ClienteEnriquecido {
  id: string; nombre: string; contacto?: string; email?: string
  telefono?: string; sector?: string; direccion?: string
  pais?: string; limite_credito?: number; notas?: string
  fecha_registro?: string; ultima_venta?: string | null
  num_ventas: number; num_cotizaciones: number; credito_activo: boolean
}

interface ClienteKpis {
  total: number; conVentas: number; nuevosMes: number; conCredito: number
  activos30: number; inactivos60: number; riesgo: number
}

interface Props { clientes: ClienteEnriquecido[]; kpis: ClienteKpis }

function ActividadBadge({ ultimaVenta }: { ultimaVenta?: string | null }) {
  if (!ultimaVenta) return <span className="badge badge-gray">Sin ventas</span>
  const dias = Math.floor((Date.now() - new Date(ultimaVenta).getTime()) / 86400000)
  if (dias <= 30) return <span className="badge badge-green">Activo ({dias}d)</span>
  if (dias <= 60) return <span className="badge badge-amber">En riesgo ({dias}d)</span>
  return <span className="badge badge-red">Inactivo ({dias}d)</span>
}

function ClienteModal({ edit, onClose, onSaved }: {
  edit: ClienteEnriquecido | null; onClose: () => void; onSaved: () => void
}) {
  const [nombre,        setNombre]        = useState(edit?.nombre ?? '')
  const [contacto,      setContacto]      = useState(edit?.contacto ?? '')
  const [email,         setEmail]         = useState(edit?.email ?? '')
  const [telefono,      setTelefono]      = useState(edit?.telefono ?? '')
  const [sector,        setSector]        = useState(edit?.sector ?? '')
  const [direccion,     setDireccion]     = useState(edit?.direccion ?? '')
  const [pais,          setPais]          = useState(edit?.pais ?? 'El Salvador')
  const [limiteCredito, setLimiteCredito] = useState<number>(edit?.limite_credito ?? 0)
  const [notas,         setNotas]         = useState(edit?.notas ?? '')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  async function handleSave() {
    if (!nombre.trim()) return setError('El nombre del cliente es requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_cliente', editId: edit?.id, nombre, contacto, email, telefono, sector, direccion, pais, limiteCredito, notas }),
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
      <div className="modal-box" style={{ maxWidth: 540 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Cliente' : '👥 Nuevo Cliente'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Nombre / Empresa <span className="req">*</span></label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del cliente o empresa" />
          </div>
          <div className="field">
            <label>Contacto</label>
            <input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Persona de contacto" />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+503 0000-0000" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="correo@empresa.com" />
          </div>
          <div className="field">
            <label>Sector</label>
            <select value={sector} onChange={e => setSector(e.target.value)}>
              <option value="">—</option>
              {SECTORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Dirección</label>
            <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Dirección de entrega habitual" />
          </div>
          <div className="field">
            <label>País</label>
            <input value={pais} onChange={e => setPais(e.target.value)} placeholder="El Salvador" />
          </div>
          <div className="field">
            <label>Límite de crédito (USD)</label>
            <input
              type="number" min="0" step="0.01"
              value={limiteCredito === 0 ? '' : limiteCredito}
              onChange={e => setLimiteCredito(parseFloat(e.target.value) || 0)}
              placeholder="0 = sin límite"
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notas</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} placeholder="Condiciones especiales, preferencias..." rows={2} />
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

export default function ClientesModule({ clientes: initialClientes, kpis }: Props) {
  const [clientes,   setClientes]   = useState(initialClientes)
  const [estadoCuenta, setEstadoCuenta] = useState<string | null>(null)
  const [portalCliente, setPortalCliente] = useState<{ id: string; nombre: string } | null>(null)
  const [showModal,  setShowModal]  = useState(false)
  const [editCliente,setEditCliente]= useState<ClienteEnriquecido | null>(null)
  const [search,     setSearch]     = useState('')
  const [filterSec,  setFilterSec]  = useState('')
  const [activeTab,  setActiveTab]  = useState<'todos' | 'riesgo' | 'inactivos'>('todos')

  const hoy = today()
  const hace30s = new Date(hoy); hace30s.setDate(hace30s.getDate() - 30)
  const hace60s = new Date(hoy); hace60s.setDate(hace60s.getDate() - 60)
  const h30 = hace30s.toISOString().slice(0, 10)
  const h60 = hace60s.toISOString().slice(0, 10)

  const sectores = Array.from(new Set(clientes.map(c => c.sector).filter(Boolean)))

  const filtered = clientes.filter(c => {
    if (filterSec && c.sector !== filterSec) return false
    if (search && !c.nombre.toLowerCase().includes(search.toLowerCase()) &&
        !(c.email ?? '').toLowerCase().includes(search.toLowerCase())) return false
    if (activeTab === 'riesgo')    return c.ultima_venta && c.ultima_venta >= h60 && c.ultima_venta < h30
    if (activeTab === 'inactivos') return !c.ultima_venta || c.ultima_venta < h60
    return true
  })

  async function deleteCliente(id: string) {
    if (!confirm('¿Eliminar este cliente? Las ventas y cotizaciones no se eliminan.')) return
    await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_cliente', id }) })
    setClientes(c => c.filter(x => x.id !== id))
  }

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs fila 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
        {[
          { label: 'Total Clientes',     value: String(kpis.total),      color: 'var(--teal)'   },
          { label: 'Con Ventas',         value: String(kpis.conVentas),  color: 'var(--green)'  },
          { label: 'Nuevos este Mes',    value: String(kpis.nuevosMes),  color: 'var(--blue)'   },
          { label: 'Con Crédito Activo', value: String(kpis.conCredito), color: 'var(--amber)'  },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 22 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* KPIs fila 2 — segmentación */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Activos últimos 30d',   value: String(kpis.activos30),   color: 'var(--green)', tab: 'todos' as const },
          { label: 'En riesgo (31–60d)',     value: String(kpis.riesgo),      color: 'var(--amber)', tab: 'riesgo' as const },
          { label: 'Inactivos +60d',         value: String(kpis.inactivos60), color: 'var(--red)',   tab: 'inactivos' as const },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}`, cursor: 'pointer' }}
            onClick={() => setActiveTab(k.tab)}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 22 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Controles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Buscar cliente / email..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)', minWidth: 200 }} />
          <select value={filterSec} onChange={e => setFilterSec(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
            <option value="">Todos los sectores</option>
            {sectores.map(s => <option key={s as string} value={s as string}>{s as string}</option>)}
          </select>
          {activeTab !== 'todos' && (
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveTab('todos')}>✕ Limpiar filtro</button>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => { setEditCliente(null); setShowModal(true) }}>+ Nuevo Cliente</button>
      </div>

      {/* Tabla */}
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Cliente</th><th>Contacto</th><th>Email</th><th>Teléfono</th>
              <th>Sector</th><th>Cots.</th><th>Ventas</th><th>Última compra</th><th>Actividad</th><th>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>
                    {c.nombre}
                    {c.credito_activo && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--amber)', background: 'rgba(217,119,6,.15)', padding: '1px 5px', borderRadius: 4 }}>CXC</span>}
                    {c.limite_credito && c.limite_credito > 0 && <span style={{ marginLeft: 4, fontSize: 9, color: '#7c3aed', background: 'rgba(124,58,237,.12)', padding: '1px 5px', borderRadius: 4 }}>LÍM ${c.limite_credito.toFixed(0)}</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>{c.contacto ?? '–'}</td>
                  <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.email ?? '–'}</td>
                  <td style={{ fontSize: 11 }}>{c.telefono ?? '–'}</td>
                  <td><span className="badge badge-gray">{c.sector ?? '–'}</span></td>
                  <td className="mono" style={{ textAlign: 'center', fontSize: 12 }}>{c.num_cotizaciones}</td>
                  <td className="mono" style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>{c.num_ventas}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.ultima_venta ?? '–'}</td>
                  <td><ActividadBadge ultimaVenta={c.ultima_venta} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" title="Estado de cuenta" onClick={() => setEstadoCuenta(c.nombre)}>📋</button>
                      <button className="btn btn-secondary btn-sm" title="Portal de cliente" onClick={() => setPortalCliente({ id: c.id, nombre: c.nombre })}>🔗</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditCliente(c); setShowModal(true) }}>✏️</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteCliente(c.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin clientes</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt3)', padding: '8px 0 0', textAlign: 'right' }}>
          Mostrando {filtered.length} de {clientes.length} clientes
        </div>
      </div>

      {showModal && (
        <ClienteModal
          edit={editCliente}
          onClose={() => { setShowModal(false); setEditCliente(null) }}
          onSaved={() => { setShowModal(false); setEditCliente(null); window.location.reload() }}
        />
      )}
      {estadoCuenta && (
        <EstadoCuentaModal
          clienteNombre={estadoCuenta}
          onClose={() => setEstadoCuenta(null)}
        />
      )}
      {portalCliente && (
        <PortalLinkModal
          clienteId={portalCliente.id}
          clienteNombre={portalCliente.nombre}
          onClose={() => setPortalCliente(null)}
        />
      )}
    </div>
  )
}

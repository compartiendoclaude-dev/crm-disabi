'use client'
import { useState } from 'react'
import { fmtUSD } from '@/lib/utils'
import type { Proveedor } from '@/lib/types'

const UNIDADES = ['botella','caja','galón','litro','kg','gramo','unidad','docena','paquete','saco']

interface ProveedorEnriquecido extends Proveedor {
  num_compras: number
  total_comprado: number
  ultima_compra: string | null
}

interface Props {
  proveedores: ProveedorEnriquecido[]
  proveedoresTextoLibre: string[]
  comprasSinVincular: { id: string; proveedor: string; fecha: string; monto_final?: number; monto_total?: number }[]
  kpis: { total: number; activos: number; locales: number; importacion: number; sinVincular: number }
}

function ProveedorModal({ edit, onClose, onSaved }: {
  edit: ProveedorEnriquecido | null; onClose: () => void; onSaved: () => void
}) {
  const [nombre,        setNombre]        = useState(edit?.nombre ?? '')
  const [razonSocial,   setRazonSocial]   = useState(edit?.razon_social ?? '')
  const [nit,           setNit]           = useState(edit?.nit ?? '')
  const [nrc,           setNrc]           = useState(edit?.nrc ?? '')
  const [contacto,      setContacto]      = useState(edit?.contacto ?? '')
  const [email,         setEmail]         = useState(edit?.email ?? '')
  const [telefono,      setTelefono]      = useState(edit?.telefono ?? '')
  const [pais,          setPais]          = useState(edit?.pais ?? 'El Salvador')
  const [direccion,     setDireccion]     = useState(edit?.direccion ?? '')
  const [tipo,          setTipo]          = useState<'local'|'importacion'|'ambos'>(edit?.tipo ?? 'local')
  const [moneda,        setMoneda]        = useState(edit?.moneda ?? 'USD')
  const [diasCredito,   setDiasCredito]   = useState(edit?.dias_credito ?? 0)
  const [limiteCredito, setLimiteCredito] = useState(edit?.limite_credito ?? 0)
  const [notas,         setNotas]         = useState(edit?.notas ?? '')
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')

  async function handleSave() {
    if (!nombre.trim()) return setError('Nombre requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/proveedores', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_proveedor', editId: edit?.id,
          nombre, razon_social: razonSocial, nit, nrc, contacto, email,
          telefono, pais, direccion, tipo, moneda, dias_credito: diasCredito,
          limite_credito: limiteCredito, notas, activo: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally { setSaving(false) }
  }

  const tipoColor = tipo === 'local' ? 'var(--blue)' : tipo === 'importacion' ? 'var(--purple)' : 'var(--teal)'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Proveedor' : '🏭 Nuevo Proveedor'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        {/* Tipo de proveedor */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['local', 'importacion', 'ambos'] as const).map(t => (
            <button key={t} onClick={() => setTipo(t)}
              style={{ flex: 1, padding: '8px', borderRadius: 'var(--r)', border: `1px solid ${tipo === t ? tipoColor : 'var(--bdr)'}`, background: tipo === t ? tipoColor + '22' : 'var(--surf2)', color: tipo === t ? tipoColor : 'var(--txt3)', fontWeight: tipo === t ? 700 : 400, fontSize: 12, cursor: 'pointer' }}>
              {t === 'local' ? '🏪 Local' : t === 'importacion' ? '🌐 Importación' : '🔄 Ambos'}
            </button>
          ))}
        </div>

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Nombre / Razón comercial <span className="req">*</span></label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del proveedor" />
          </div>
          <div className="field">
            <label>Razón social (legal)</label>
            <input value={razonSocial} onChange={e => setRazonSocial(e.target.value)} placeholder="S.A. de C.V. ..." />
          </div>
          <div className="field">
            <label>País de origen</label>
            <input value={pais} onChange={e => setPais(e.target.value)} placeholder="El Salvador / Guatemala..." />
          </div>
          <div className="field">
            <label>NIT</label>
            <input value={nit} onChange={e => setNit(e.target.value)} placeholder="0000-000000-000-0" />
          </div>
          <div className="field">
            <label>NRC</label>
            <input value={nrc} onChange={e => setNrc(e.target.value)} placeholder="000000-0" />
          </div>
          <div className="field">
            <label>Contacto</label>
            <input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Nombre del representante" />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="+503 / +502..." />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ventas@proveedor.com" />
          </div>
          <div className="field">
            <label>Moneda</label>
            <select value={moneda} onChange={e => setMoneda(e.target.value)}>
              <option value="USD">USD — Dólar</option>
              <option value="GTQ">GTQ — Quetzal</option>
              <option value="EUR">EUR — Euro</option>
              <option value="MXN">MXN — Peso Mexicano</option>
            </select>
          </div>
          <div className="field">
            <label>Días de crédito habitual</label>
            <input type="number" min="0" value={diasCredito} onChange={e => setDiasCredito(parseInt(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Límite de crédito ($)</label>
            <input type="number" min="0" step="0.01" value={limiteCredito || ''} onChange={e => setLimiteCredito(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Dirección</label>
            <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Dirección del proveedor" />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Notas</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Condiciones especiales, términos, observaciones..." />
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function ProveedoresTab({ proveedores: initialProvs, proveedoresTextoLibre: _ptl, comprasSinVincular, kpis }: Props) {
  const [proveedores, setProveedores] = useState(initialProvs)
  const [showModal,   setShowModal]   = useState(false)
  const [editProv,    setEditProv]    = useState<ProveedorEnriquecido | null>(null)
  const [search,      setSearch]      = useState('')
  const [filterTipo,  setFilterTipo]  = useState('')
  const [showVinc,    setShowVinc]    = useState(false)

  const filtered = proveedores.filter(p => {
    if (!p.activo) return false
    if (filterTipo && p.tipo !== filterTipo) return false
    if (search && !p.nombre.toLowerCase().includes(search.toLowerCase()) &&
        !(p.contacto ?? '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  async function deleteProveedor(id: string) {
    if (!confirm('¿Eliminar/desactivar este proveedor?')) return
    const res = await fetch('/api/proveedores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_proveedor', id }) })
    const data = await res.json()
    if (data.soft) alert(data.msg)
    setProveedores(p => p.filter(x => x.id !== id))
  }

  async function vincularCompra(compra_id: string, proveedor_id: string) {
    await fetch('/api/proveedores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'vincular_compra_proveedor', compra_id, proveedor_id }) })
    window.location.reload()
  }

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total Proveedores', value: String(kpis.total),       color: 'var(--teal)'   },
          { label: 'Locales',           value: String(kpis.locales),     color: 'var(--blue)'   },
          { label: 'Importación',       value: String(kpis.importacion), color: 'var(--purple)' },
          { label: 'Sin vincular',      value: String(kpis.sinVincular), color: kpis.sinVincular > 0 ? 'var(--amber)' : 'var(--green)', sub: 'en compras' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 20 }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Alerta de compras sin vincular */}
      {kpis.sinVincular > 0 && (
        <div style={{ background: 'rgba(217,119,6,.08)', border: '1px solid rgba(217,119,6,.25)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--amber)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠️ Hay {kpis.sinVincular} proveedores en texto libre en compras que aún no están en el maestro.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowVinc(!showVinc)}>
            {showVinc ? '▲ Ocultar' : '🔗 Ver y vincular'}
          </button>
        </div>
      )}

      {/* Panel de vinculación */}
      {showVinc && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>🔗 Compras sin proveedor vinculado</div>
          <table className="tbl">
            <thead><tr><th>Proveedor (texto)</th><th>Fecha</th><th>Monto</th><th>Vincular a</th></tr></thead>
            <tbody>
              {comprasSinVincular.slice(0, 20).map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.proveedor}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.fecha}</td>
                  <td className="mono">{fmtUSD(c.monto_final ?? c.monto_total ?? 0)}</td>
                  <td>
                    <select onChange={e => { if (e.target.value) vincularCompra(c.id, e.target.value) }}
                      style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '4px 8px', fontSize: 11, color: 'var(--txt)' }}>
                      <option value="">— Seleccionar proveedor —</option>
                      {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Controles */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Buscar proveedor..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)', minWidth: 180 }} />
          <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
            style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
            <option value="">Todos los tipos</option>
            <option value="local">Local</option>
            <option value="importacion">Importación</option>
            <option value="ambos">Ambos</option>
          </select>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditProv(null); setShowModal(true) }}>
          + Nuevo Proveedor
        </button>
      </div>

      {/* Tabla */}
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Proveedor</th><th>Tipo</th><th>País</th><th>Contacto</th>
              <th>Crédito</th><th>Moneda</th><th>Compras</th><th>Total comprado</th><th>Última compra</th><th>Acción</th>
            </tr></thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{p.nombre}</div>
                    {p.razon_social && <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{p.razon_social}</div>}
                  </td>
                  <td>
                    <span className={`badge ${p.tipo === 'local' ? 'badge-blue' : p.tipo === 'importacion' ? 'badge-purple' : 'badge-teal'}`}>
                      {p.tipo === 'local' ? '🏪 Local' : p.tipo === 'importacion' ? '🌐 Importación' : '🔄 Ambos'}
                    </span>
                  </td>
                  <td style={{ fontSize: 11 }}>{p.pais ?? '–'}</td>
                  <td style={{ fontSize: 11 }}>
                    <div>{p.contacto ?? '–'}</div>
                    {p.telefono && <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{p.telefono}</div>}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    <div className="mono">{p.dias_credito ?? 0} días</div>
                    {(p.limite_credito ?? 0) > 0 && <div style={{ fontSize: 10, color: 'var(--txt3)' }}>Límite: {fmtUSD(p.limite_credito ?? 0)}</div>}
                  </td>
                  <td><span className="badge badge-gray">{p.moneda ?? 'USD'}</span></td>
                  <td className="mono" style={{ textAlign: 'center', fontWeight: 700 }}>{p.num_compras}</td>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(p.total_comprado)}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{p.ultima_compra ?? '–'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEditProv(p); setShowModal(true) }}>✏️</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteProveedor(p.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>
                  Sin proveedores registrados. Agrega el primero con el botón &quot;+ Nuevo Proveedor&quot;.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sección de unidades estándar */}
      <div style={{ marginTop: 12, background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '10px 14px', fontSize: 11, color: 'var(--txt3)' }}>
        <strong style={{ color: 'var(--txt2)' }}>Unidades estándar de medida:</strong>{' '}
        {UNIDADES.map(u => (
          <span key={u} style={{ background: 'var(--surf)', border: '1px solid var(--bdr)', borderRadius: 4, padding: '1px 6px', marginRight: 4, fontSize: 10 }}>{u}</span>
        ))}
      </div>

      {showModal && (
        <ProveedorModal
          edit={editProv}
          onClose={() => { setShowModal(false); setEditProv(null) }}
          onSaved={() => { setShowModal(false); setEditProv(null); window.location.reload() }}
        />
      )}
    </div>
  )
}

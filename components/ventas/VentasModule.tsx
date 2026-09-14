'use client'
import { useState, useCallback } from 'react'
import DevolucionesTab from './DevolucionesTab'
import { fmtUSD, calcLiquidacion, today } from '@/lib/utils'
import { PAQUETERAS, METODOS_PAGO, DIAS_CREDITO, CANALES, SECTORES, LIQUIDACION_PCT, ETAPAS_OPORTUNIDAD, ETAPAS_OPORTUNIDAD_ABIERTAS, ETAPA_COLOR } from '@/lib/constants'
import type { Venta, Cotizacion, Producto, Cliente, MetodoPago, Empleado, Oportunidad, EtapaOportunidad } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface CartItem {
  producto_id?: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct: number
  subtotal: number
}

interface VentasModuleProps {
  ventas: Venta[]
  cotizaciones: Cotizacion[]
  pendientesPago: Cotizacion[]
  productos: Producto[]
  clientes: Cliente[]
  kpis: { ultimaMonto: number; ultimaFecha: string; ultimaCliente: string; diaTotal: number; diaItems: number; semTotal: number; semItems: number; mesTotal: number; mesItems: number }
  cotKpis: { total: number; enviadas: number; aprobadas: number; aprobMonto: number; rechazadas: number; tasa: number }
  ppKpis: { total: number; totalMonto: number; vencidos: number; vencidosMonto: number; semana: number; semanaMonto: number }
  devoluciones: import('@/lib/types').Devolucion[]
  ventasDevolvibles: Venta[]
  devKpis: { totalMes: number; montoMes: number; totalGeneral: number; montoGeneral: number }
  empleados: Empleado[]
  mesActual: string
  hoy: string
  oportunidades: Oportunidad[]
  opKpis: { abiertas: number; valorPipeline: number; ganadasMes: number; ganadasMesMonto: number; perdidasMes: number; tasaConversionMes: number; nuevasHoy: number; nuevasSemana: number; nuevasMes: number }
}

// ─── Badge helper ─────────────────────────────────────────────────────────────
function EstadoBadge({ cobro }: { cobro: string }) {
  const map: Record<string, { label: string; color: string }> = {
    Cobrado:               { label: 'Pagado',            color: '#16a34a' },
    Pendiente:             { label: 'Crédito',           color: '#d97706' },
    Borrador:              { label: 'Borrador',           color: '#6b7280' },
    Parcial:               { label: 'Parcial',            color: '#7c3aed' },
    Liquidacion_Pendiente: { label: 'Liquidación pend.', color: '#0891b2' },
  }
  const e = map[cobro] ?? { label: cobro, color: '#6b7280' }
  return (
    <span style={{ background: e.color + '22', color: e.color, border: `1px solid ${e.color}44`,
      padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
      {e.label}
    </span>
  )
}

// ─── KPI strip ───────────────────────────────────────────────────────────────
function KStrip({ items }: { items: { label: string; value: string; sub?: string; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 10, marginBottom: 16 }}>
      {items.map(k => (
        <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color ?? 'var(--teal)'}` }}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value" style={{ color: k.color ?? 'var(--teal)', fontSize: 20 }}>{k.value}</div>
          {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── MODAL VENTA ─────────────────────────────────────────────────────────────
function VentaModal({ productos, clientes, empleados, editVenta, onClose, onSaved }:
  { productos: Producto[]; clientes: Cliente[]; empleados: Empleado[]; editVenta: Venta | null; onClose: () => void; onSaved: () => void }) {

  const [nombre,     setNombre]     = useState(editVenta?.nombre ?? '')
  const [vendedorId, setVendedorId] = useState(editVenta?.vendedor_id ?? '')
  const [fecha,    setFecha]    = useState(editVenta?.fecha ?? today())
  const [sector,   setSector]   = useState(editVenta?.sector ?? '')
  const [canal,    setCanal]    = useState(editVenta?.canal ?? 'Mostrador')
  const [notas,    setNotas]    = useState(editVenta?.notas ?? '')
  const [borrador, setBorrador] = useState(editVenta?.cobro === 'Borrador')

  const [metodo,   setMetodo]   = useState<MetodoPago>((editVenta?.metodo_pago as MetodoPago) ?? 'Efectivo')
  const [conPaq,        setConPaq]        = useState(editVenta?.con_paquetera_efectivo ?? false)
  const [paqCobroCliente, setPaqCobroCliente] = useState<number>((editVenta as { paquetera_cobro_cliente?: number } | null)?.paquetera_cobro_cliente ?? 0)
  const [dias,     setDias]     = useState<number>(30)
  const [c5050,    setC5050]    = useState(editVenta?.credito_50_50 ?? false)
  const [paqKey,   setPaqKey]   = useState(editVenta?.paquetera ? Object.keys(PAQUETERAS).find(k => PAQUETERAS[k as keyof typeof PAQUETERAS].nombre === editVenta.paquetera) ?? '' : '')
  const [fechaRec, setFechaRec] = useState(editVenta?.fecha_recoleccion ?? '')

  const [cart,     setCart]     = useState<CartItem[]>([])
  const [selProd,  setSelProd]  = useState('')
  const [qty,      setQty]      = useState(1)
  const [precio,   setPrecio]   = useState(0)
  const [descPct,  setDescPct]  = useState(0)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const monto    = cart.reduce((a, i) => a + i.subtotal, 0)
  const liq      = LIQUIDACION_PCT[metodo] ? calcLiquidacion(monto, metodo) : null
  const paqInfo  = paqKey ? PAQUETERAS[paqKey as keyof typeof PAQUETERAS] : null

  function onPickProd(id: string) {
    setSelProd(id)
    const p = productos.find(x => x.id === id)
    if (p) setPrecio(p.precio_venta)
  }

  function addItem() {
    if (!precio) return
    const prod = productos.find(x => x.id === selProd)
    const sub  = parseFloat((precio * qty * (1 - descPct / 100)).toFixed(2))
    setCart(c => [...c, { producto_id: selProd || undefined, descripcion: prod?.nombre ?? 'Producto', cantidad: qty, precio_unitario: precio, descuento_pct: descPct, subtotal: sub }])
    setSelProd(''); setPrecio(0); setQty(1); setDescPct(0)
  }

  function removeItem(i: number) { setCart(c => c.filter((_, idx) => idx !== i)) }

  async function handleSave() {
    if (!nombre.trim()) return setError('El nombre del cliente es requerido')
    if (!cart.length)   return setError('Agrega al menos un producto al carrito')

    // Validar límite de crédito
    if (metodo === 'Credito' && !borrador) {
      const clienteSeleccionado = clientes.find(c => c.nombre.toLowerCase().trim() === nombre.toLowerCase().trim())
      if (clienteSeleccionado?.limite_credito && clienteSeleccionado.limite_credito > 0) {
        const montoVenta = cart.reduce((a, i) => a + i.subtotal, 0)
        if (montoVenta > clienteSeleccionado.limite_credito) {
          return setError(
            `⚠️ Límite de crédito excedido. Límite: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(clienteSeleccionado.limite_credito)} — Venta: ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(montoVenta)}`
          )
        }
      }
    }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_venta',
          editId: editVenta?.id,
          nombre, fecha, sector, canal, notas,
          vendedorId: vendedorId || null,
          metodoPago: metodo, esBorrador: borrador,
          diasCredito: dias, credito5050: c5050,
          conPaquetera: conPaq, paqueteraKey: paqKey,
          paqCobroCliente,
          fechaRecoleccion: fechaRec,
          items: cart,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{editVenta ? '✏️ Editar Venta' : '💰 Registrar Venta'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        {/* Datos del cliente */}
        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Cliente <span className="req">*</span></label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre del cliente / empresa"
              list="clientes-list" />
            <datalist id="clientes-list">
              {clientes.map(c => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Fecha <span className="req">*</span></label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field">
            <label>Canal</label>
            <select value={canal} onChange={e => setCanal(e.target.value)}>
              {CANALES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sector</label>
            <select value={sector} onChange={e => setSector(e.target.value)}>
              <option value="">—</option>
              {SECTORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Vendedor</label>
            <select value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {empleados.filter(e => e.activo !== false).map(e => (
                <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` (${e.cargo})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={borrador ? 'Borrador' : 'Activa'} onChange={e => setBorrador(e.target.value === 'Borrador')}>
              <option value="Activa">Activa</option>
              <option value="Borrador">Borrador</option>
            </select>
          </div>
        </div>

        {/* Método de pago */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>💳 Método de Pago</div>
          <div className="grid-4">
            <div className="field">
              <label>Método <span className="req">*</span></label>
              <select value={metodo} onChange={e => { setMetodo(e.target.value as MetodoPago); setConPaq(false) }}>
                {METODOS_PAGO.map(m => <option key={m} value={m}>{m === 'Pago POS' ? 'Pago POS (TC/TD)' : m}</option>)}
              </select>
            </div>

            {metodo === 'Efectivo' && (
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 8 }}>
                  <input type="checkbox" checked={conPaq} onChange={e => setConPaq(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--amber)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Lleva paquetera</span>
                </label>
              </div>
            )}

            {metodo === 'Credito' && (<>
              <div className="field">
                <label>Días de crédito</label>
                <select value={dias} onChange={e => setDias(Number(e.target.value))}>
                  {DIAS_CREDITO.map(d => <option key={d} value={d}>{d} días</option>)}
                </select>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', paddingTop: 8 }}>
                  <input type="checkbox" checked={c5050} onChange={e => setC5050(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--amber)' }} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>50% adelanto + 50% contraentrega</span>
                </label>
              </div>
            </>)}
          </div>

          {/* Resumen liquidación */}
          {liq && (
            <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '10px 14px', maxWidth: 340, marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 6 }}>
                {metodo} — {liq.comisionPct}% comisión
              </div>
              {[
                ['Monto neto (sin IVA)', fmtUSD(liq.montoNeto), 'var(--txt)'],
                ['IVA percibido (2%)',    fmtUSD(liq.ivaPercibido), 'var(--amber)'],
                [`Comisión (${liq.comisionPct}%)`, fmtUSD(liq.comision), 'var(--amber)'],
                ['IVA de la comisión (13%)', fmtUSD(liq.ivaComision), 'var(--amber)'],
              ].map(([label, val, color]) => (
                <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                  <span style={{ color: 'var(--txt2)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: color as string }}>{val}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, borderTop: '1px solid var(--bdr)', paddingTop: 5, marginTop: 5 }}>
                <span style={{ fontWeight: 700 }}>Líquido a pagar</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--green)' }}>{fmtUSD(liq.montoLiquido)}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 6, fontStyle: 'italic' }}>Queda como &quot;Liquidación pendiente&quot;</div>
            </div>
          )}
        </div>

        {/* Paquetera */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>📦 Paquetera / Envío</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '0 0 160px' }}>
              <label>Paquetera</label>
              <select value={paqKey} onChange={e => setPaqKey(e.target.value)}>
                <option value="">Sin paquetera</option>
                {Object.entries(PAQUETERAS).map(([k, v]) => (
                  <option key={k} value={k}>{v.nombre} (${v.costoEnvio.toFixed(2)} + {v.comisionPct}%)</option>
                ))}
              </select>
            </div>
            {paqKey && (
              <div className="field" style={{ flex: '0 0 150px' }}>
                <label>Fecha de recolección</label>
                <input type="date" value={fechaRec} onChange={e => setFechaRec(e.target.value)} />
              </div>
            )}
            {paqKey && (
              <div className="field" style={{ flex: '0 0 130px' }}>
                <label>Cobro al cliente ($)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={paqCobroCliente || ''}
                  onChange={e => setPaqCobroCliente(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                />
              </div>
            )}
            {paqKey && paqInfo && (
              <div style={{ fontSize: 11, color: 'var(--txt3)', paddingBottom: 8 }}>
                Costo DISABI: <strong style={{ color: 'var(--txt)' }}>{fmtUSD(paqInfo.costoEnvio)}</strong>
                {' · '}Comisión: <strong style={{ color: 'var(--amber)' }}>{fmtUSD(monto * paqInfo.comisionPct / 100)}</strong>
                {paqCobroCliente > 0 && <> · <span style={{ color: 'var(--green)' }}>Cobro cliente: <strong>{fmtUSD(paqCobroCliente)}</strong></span></>}
              </div>
            )}
          </div>
        </div>

        {/* Carrito */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🛒 Productos</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label>Producto del catálogo</label>
              <select value={selProd} onChange={e => onPickProd(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {productos.map(p => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre} (Stock: {p.stock_actual})</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '0 0 60px' }}>
              <label>Cant.</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: '0 0 90px' }}>
              <label>Precio $</label>
              <input type="number" min="0" step="0.01" value={precio || ''} onChange={e => setPrecio(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: '0 0 70px' }}>
              <label>Desc. %</label>
              <input type="number" min="0" max="100" value={descPct} onChange={e => setDescPct(Number(e.target.value))} />
            </div>
            <button className="btn btn-secondary" onClick={addItem} style={{ marginBottom: 2 }}>+ Agregar</button>
          </div>

          {/* Tabla carrito */}
          {cart.length > 0 && (
            <table className="tbl" style={{ marginBottom: 8 }}>
              <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.%</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                {cart.map((item, i) => (
                  <tr key={i}>
                    <td>{item.descripcion}</td>
                    <td className="mono">{item.cantidad}</td>
                    <td className="mono">{fmtUSD(item.precio_unitario)}</td>
                    <td className="mono">{item.descuento_pct}%</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(item.subtotal)}</td>
                    <td><button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>🗑</button></td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--bdr)' }}>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>TOTAL</td>
                  <td className="mono" style={{ fontWeight: 800, fontSize: 15, color: 'var(--teal)' }}>{fmtUSD(monto)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Notas */}
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Notas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones, instrucciones de entrega..." rows={2} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar Venta'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── MODAL COTIZACIÓN ─────────────────────────────────────────────────────────
// prefillOp: cuando la cotización nace de "Convertir a Cotización" en una
// Oportunidad — precarga cliente/contacto y manda oportunidad_id al guardar
// para que quede vinculada (ver action=save_cotizacion en /api/ventas).
function CotizacionModal({ productos, clientes, editCot, prefillOp, onClose, onSaved }:
  { productos: Producto[]; clientes: Cliente[]; editCot: Cotizacion | null
    prefillOp?: { id: string; numero?: string; cliente: string; contacto?: string; telefono?: string; email?: string; sector?: string }
    onClose: () => void; onSaved: () => void }) {

  const [cliente,   setCliente]   = useState(editCot?.cliente ?? prefillOp?.cliente ?? '')
  const [fechaEm,   setFechaEm]   = useState(editCot?.fecha_emision ?? today())
  const [fechaVence,setFechaVence]= useState(editCot?.fecha_vence ?? '')
  const [estado,    setEstado]    = useState<string>(editCot?.estado ?? 'Borrador')
  const [notas,     setNotas]     = useState(editCot?.notas ?? '')
  const [cart,      setCart]      = useState<CartItem[]>(
    editCot?.items?.map(i => ({
      producto_id: i.producto_id ?? undefined,
      descripcion: (i as { producto?: { nombre: string } }).producto?.nombre ?? '',
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      descuento_pct: (i as { descuento_pct?: number }).descuento_pct ?? 0,
      subtotal: i.subtotal,
    })) ?? []
  )
  const [selProd, setSelProd] = useState('')
  const [qty,     setQty]     = useState(1)
  const [precio,  setPrecio]  = useState(0)
  const [descPct, setDescPct] = useState(0)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const total = cart.reduce((a, i) => a + i.subtotal, 0)

  function onPickProd(id: string) {
    setSelProd(id)
    const p = productos.find(x => x.id === id)
    if (p) setPrecio(p.precio_venta)
  }

  function addItem() {
    if (!precio) return
    const prod = productos.find(x => x.id === selProd)
    const sub  = parseFloat((precio * qty * (1 - descPct / 100)).toFixed(2))
    setCart(prev => [...prev, {
      producto_id: selProd || undefined,
      descripcion: prod?.nombre ?? 'Producto',
      cantidad: qty, precio_unitario: precio,
      descuento_pct: descPct, subtotal: sub,
    }])
    setSelProd(''); setPrecio(0); setQty(1); setDescPct(0)
  }

  async function handleSave() {
    if (!cliente.trim()) return setError('El cliente es requerido')
    if (!cart.length)    return setError('Agrega al menos un producto')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_cotizacion',
          editId: editCot?.id,
          tipo: 'Cotizacion',
          cliente: cliente.trim(),
          contacto: prefillOp?.contacto || undefined,
          telefono: prefillOp?.telefono || undefined,
          email:    prefillOp?.email || undefined,
          sector:   prefillOp?.sector || undefined,
          oportunidad_id: !editCot ? prefillOp?.id : undefined,
          fecha_emision: fechaEm,
          fecha_vence: fechaVence || null,
          estado,
          notas: notas || null,
          subtotal: total,
          descuento_pct: 0, descuento_monto: 0,
          impuesto_pct: 0,  impuesto_monto: 0,
          total,
          items: cart,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const ESTADOS_COT = ['Borrador', 'Enviada', 'Aprobada', 'Rechazada']

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{editCot ? '✏️ Editar Cotización' : '📄 Nueva Cotización'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {!editCot && prefillOp && (
          <div style={{ background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.25)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--txt2)', marginBottom: 12 }}>
            🎯 Se vinculará a la oportunidad <strong>{prefillOp.numero ?? prefillOp.id.slice(0, 8)}</strong>
          </div>
        )}
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Cliente <span className="req">*</span></label>
            <input value={cliente} onChange={e => setCliente(e.target.value)}
              placeholder="Nombre del cliente" list="cot-clientes-list" />
            <datalist id="cot-clientes-list">
              {clientes.map(c => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value)}>
              {ESTADOS_COT.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Fecha emisión</label>
            <input type="date" value={fechaEm} onChange={e => setFechaEm(e.target.value)} />
          </div>
          <div className="field">
            <label>Válida hasta</label>
            <input type="date" value={fechaVence} onChange={e => setFechaVence(e.target.value)} />
          </div>
        </div>

        {/* Productos */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🛒 Productos</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label>Producto</label>
              <select value={selProd} onChange={e => onPickProd(e.target.value)}>
                <option value="">— Seleccionar —</option>
                {productos.map(p => (
                  <option key={p.id} value={p.id}>{p.codigo} — {p.nombre} (${p.precio_venta.toFixed(2)})</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: '0 0 60px' }}>
              <label>Cant.</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: '0 0 90px' }}>
              <label>Precio $</label>
              <input type="number" min="0" step="0.01" value={precio || ''} onChange={e => setPrecio(Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: '0 0 70px' }}>
              <label>Desc. %</label>
              <input type="number" min="0" max="100" value={descPct} onChange={e => setDescPct(Number(e.target.value))} />
            </div>
            <button className="btn btn-secondary" onClick={addItem} style={{ marginBottom: 2 }}>+ Agregar</button>
          </div>
          {cart.length > 0 && (
            <table className="tbl" style={{ marginBottom: 8 }}>
              <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.%</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                {cart.map((item, i) => (
                  <tr key={i}>
                    <td>{item.descripcion}</td>
                    <td className="mono">{item.cantidad}</td>
                    <td className="mono">{fmtUSD(item.precio_unitario)}</td>
                    <td className="mono">{item.descuento_pct}%</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(item.subtotal)}</td>
                    <td><button onClick={() => setCart(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}>🗑</button></td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--bdr)' }}>
                  <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>TOTAL</td>
                  <td className="mono" style={{ fontWeight: 800, color: 'var(--teal)', fontSize: 15 }}>{fmtUSD(total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Notas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
            placeholder="Condiciones, observaciones..." />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar Cotización'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL OPORTUNIDAD ────────────────────────────────────────────────────────
function OportunidadModal({ clientes, empleados, editOp, onClose, onSaved }:
  { clientes: Cliente[]; empleados: Empleado[]; editOp: Oportunidad | null; onClose: () => void; onSaved: () => void }) {

  const [cliente,   setCliente]   = useState(editOp?.cliente ?? '')
  const [clienteId, setClienteId] = useState(editOp?.cliente_id ?? '')
  const [contacto,  setContacto]  = useState(editOp?.contacto ?? '')
  const [telefono,  setTelefono]  = useState(editOp?.telefono ?? '')
  const [email,     setEmail]     = useState(editOp?.email ?? '')
  const [sector,    setSector]    = useState(editOp?.sector ?? '')
  const [canal,     setCanal]     = useState(editOp?.canal ?? 'Referido')
  const [descripcion, setDescripcion] = useState(editOp?.descripcion ?? '')
  const [valorEst,  setValorEst]  = useState<number>(editOp?.valor_estimado ?? 0)
  const [prob,      setProb]      = useState<number>(editOp?.probabilidad_pct ?? 20)
  const [fechaCierre, setFechaCierre] = useState(editOp?.fecha_estimada_cierre ?? '')
  const [vendedorId, setVendedorId] = useState(editOp?.vendedor_id ?? '')
  const [proxAccion, setProxAccion] = useState(editOp?.proxima_accion ?? '')
  const [fechaProx,  setFechaProx]  = useState(editOp?.fecha_proxima_accion ?? '')
  const [notas,      setNotas]      = useState(editOp?.notas ?? '')
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Autocompletar datos de contacto si el nombre coincide con un cliente ya registrado
  function onClienteChange(v: string) {
    setCliente(v)
    const match = clientes.find(c => c.nombre.toLowerCase() === v.trim().toLowerCase())
    if (match) {
      setClienteId(match.id)
      if (!contacto) setContacto(match.contacto ?? '')
      if (!telefono) setTelefono(match.telefono ?? '')
      if (!email)    setEmail(match.email ?? '')
      if (!sector && match.sector) setSector(match.sector)
    } else {
      setClienteId('')
    }
  }

  async function handleSave() {
    if (!cliente.trim()) return setError('El cliente / prospecto es requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_oportunidad',
          editId: editOp?.id,
          cliente: cliente.trim(),
          cliente_id: clienteId || null,
          contacto: contacto || null,
          telefono: telefono || null,
          email: email || null,
          sector: sector || null,
          canal: canal || null,
          descripcion: descripcion || null,
          valor_estimado: valorEst,
          probabilidad_pct: prob,
          fecha_estimada_cierre: fechaCierre || null,
          vendedor_id: vendedorId || null,
          proxima_accion: proxAccion || null,
          fecha_proxima_accion: fechaProx || null,
          notas: notas || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{editOp ? '✏️ Editar Oportunidad' : '🎯 Nueva Oportunidad'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Cliente / prospecto <span className="req">*</span></label>
            <input value={cliente} onChange={e => onClienteChange(e.target.value)}
              placeholder="Nombre del cliente o prospecto" list="op-clientes-list" />
            <datalist id="op-clientes-list">
              {clientes.map(c => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Canal / origen</label>
            <select value={canal} onChange={e => setCanal(e.target.value)}>
              {CANALES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Contacto</label>
            <input value={contacto} onChange={e => setContacto(e.target.value)} placeholder="Nombre de contacto" />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input value={telefono} onChange={e => setTelefono(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Sector</label>
            <select value={sector} onChange={e => setSector(e.target.value)}>
              <option value="">— Seleccionar —</option>
              {SECTORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Vendedor</label>
            <select value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {empleados.filter(e => e.activo !== false).map(e => (
                <option key={e.id} value={e.id}>{e.nombre}{e.cargo ? ` (${e.cargo})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Valor estimado $</label>
            <input type="number" min="0" step="0.01" value={valorEst} onChange={e => setValorEst(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Probabilidad de cierre %</label>
            <input type="number" min="0" max="100" value={prob} onChange={e => setProb(Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Fecha estimada de cierre</label>
            <input type="date" value={fechaCierre} onChange={e => setFechaCierre(e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>¿Qué necesita el cliente?</label>
          <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={2}
            placeholder="Productos de interés, volumen, contexto de la negociación..." />
        </div>

        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Próxima acción</label>
            <input value={proxAccion} onChange={e => setProxAccion(e.target.value)} placeholder="Ej. Llamar para dar seguimiento" />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fechaProx} onChange={e => setFechaProx(e.target.value)} />
          </div>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>Notas</label>
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar Oportunidad'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL SUBIR DTE (vinculado a una venta) ───────────────────────────────────
// Comercial no tiene el módulo DTE completo — esto es un atajo angosto: sube
// UN solo JSON de DTE y lo vincula de una vez a la venta que se acaba de
// registrar, sin pasar por Importación masiva ni Cierre Mensual de DTE.
function DteUploadModal({ venta, onClose, onSaved }: { venta: Venta; onClose: () => void; onSaved: () => void }) {
  const [file,    setFile]    = useState<File | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  async function handleUpload() {
    if (!file) return setError('Selecciona el archivo JSON del DTE')
    setSaving(true); setError('')
    try {
      const text = await file.text()
      let json: unknown
      try { json = JSON.parse(text) } catch { throw new Error('El archivo no es un JSON válido') }

      const impRes = await fetch('/api/dte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_dte', documentos: [{ json, nombre: file.name }] }),
      })
      const impData = await impRes.json()
      if (!impRes.ok) throw new Error(impData.error || 'Error al importar el DTE')
      const resultado = impData.resultados?.[0]
      if (!resultado?.ok) throw new Error(resultado?.error || 'El DTE no se pudo importar')
      if (!resultado.id) throw new Error('El DTE se importó pero no se pudo vincular automáticamente — pide a un administrador que lo vincule desde el módulo DTE')

      const vincRes = await fetch('/api/dte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vincular_venta', dte_id: resultado.id, venta_id: venta.id }),
      })
      const vincData = await vincRes.json()
      if (!vincRes.ok) throw new Error(vincData.error || 'El DTE se importó pero no se pudo vincular a la venta')

      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al subir el DTE')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>📎 Subir DTE — {venta.numero ?? venta.nombre}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Archivo JSON del DTE</label>
          <input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <p style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 16 }}>
          Se importa y se vincula automáticamente a esta venta — no hace falta ir al módulo DTE.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleUpload} disabled={saving}>
            {saving ? '⏳ Subiendo...' : '📎 Subir y vincular'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL GASTO OPERATIVO VARIABLE ─────────────────────────────────────────────
// Versión angosta del "+ Nuevo Gasto" de Finanzas: solo crea (no edita/elimina)
// y siempre queda clasificado como Gasto Operativo Variable — el backend lo
// fuerza igual, esto es solo para no confundir con clasificaciones que
// Comercial no debe poder elegir (compra local, planilla, comisión).
function GastoVariableModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const CATS = ['Insumos', 'Transporte', 'Publicidad', 'Servicios', 'Mantenimiento', 'Personal', 'Oficina', 'Otro']
  const [fecha,       setFecha]       = useState(today())
  const [categoria,   setCategoria]   = useState('Otro')
  const [descripcion, setDescripcion] = useState('')
  const [monto,       setMonto]       = useState<number>(0)
  const [proveedor,   setProveedor]   = useState('')
  const [factura,     setFactura]     = useState('Sí')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  async function handleSave() {
    if (!monto || monto <= 0) return setError('El monto es requerido')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/finanzas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_gasto', fecha, categoria, descripcion, monto, factura, proveedor }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar el gasto')
      onSaved()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>💸 Nuevo Gasto Operativo</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field">
            <label>Categoría</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)}>
              {CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 12 }}>
          <label>Descripción</label>
          <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="¿En qué se gastó?" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="field">
            <label>Monto (USD)</label>
            <input type="number" step="0.01" value={monto || ''} onChange={e => setMonto(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Proveedor</label>
            <input value={proveedor} onChange={e => setProveedor(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label>¿Tiene factura?</label>
          <select value={factura} onChange={e => setFactura(e.target.value)}>
            <option value="Sí">Sí</option>
            <option value="No">No</option>
          </select>
        </div>
        <p style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 16 }}>
          Este gasto queda registrado como Gasto Operativo Variable.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '⏳ Guardando...' : '💾 Guardar Gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MÓDULO PRINCIPAL ─────────────────────────────────────────────────────────
export default function VentasModule({
  ventas: initialVentas, cotizaciones: initialCots, pendientesPago: initialPPs,
  productos, clientes, empleados, kpis, cotKpis, ppKpis,
  devoluciones, ventasDevolvibles, devKpis, mesActual, hoy,
  oportunidades: initialOps, opKpis,
}: VentasModuleProps) {
  const [tab,      setTab]      = useState<'ventas' | 'cotizaciones' | 'pendientes' | 'devoluciones' | 'oportunidades'>('ventas')
  const [ventas,   setVentas]   = useState(initialVentas)
  const [cots]     = useState(initialCots)
  const [pps]      = useState(initialPPs)
  const [ops]      = useState(initialOps)
  const [showModal, setShowModal] = useState(false)
  const [editVenta, setEditVenta] = useState<Venta | null>(null)
  const [showCotModal, setShowCotModal] = useState(false)
  const [editCot,      setEditCot]      = useState<Cotizacion | null>(null)
  const [cotPrefillOp, setCotPrefillOp] = useState<Oportunidad | null>(null)
  const [showOpModal,  setShowOpModal]  = useState(false)
  const [editOp,       setEditOp]       = useState<Oportunidad | null>(null)
  const [filterEtapa,  setFilterEtapa]  = useState('')
  const [search,    setSearch]    = useState('')
  const [filterMes, setFilterMes] = useState('')
  const [dteVenta,      setDteVenta]      = useState<Venta | null>(null)
  const [showGastoModal, setShowGastoModal] = useState(false)

  // Recargar ventas desde el servidor
  const reload = useCallback(async () => {
    const res = await fetch('/api/ventas?reload=1')
    if (!res.ok) return
    // Refresh simplificado — en producción usaríamos router.refresh()
    window.location.reload()
  }, [])

  async function confirmarLiquidacion(id: string) {
    if (!confirm('¿Confirmar que el depósito fue recibido?')) return
    await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirmar_liquidacion', id }) })
    reload()
  }

  async function deleteVenta(id: string) {
    if (!confirm('¿Eliminar esta venta? Esta acción no se puede deshacer.')) return
    await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_venta', id }) })
    setVentas(v => v.filter(x => x.id !== id))
  }

  async function pagarPP(id: string) {
    if (!confirm('¿Marcar este Pendiente de Pago como Pagado?')) return
    await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pagar_pp', id }) })
    reload()
  }

  async function cambiarEtapaOportunidad(op: Oportunidad, etapa: EtapaOportunidad) {
    let motivo: string | undefined
    if (etapa === 'Perdida') {
      motivo = prompt('¿Por qué se perdió esta oportunidad?') ?? undefined
      if (!motivo?.trim()) return // cancelado o vacío — el servidor lo exige, mejor no llamar
    }
    const res = await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cambiar_etapa_oportunidad', id: op.id, etapa, motivo_perdida: motivo }) })
    if (!res.ok) { const d = await res.json(); alert(d.error ?? 'Error al cambiar de etapa'); return }
    reload()
  }

  async function deleteOportunidad(id: string) {
    if (!confirm('¿Eliminar esta oportunidad? Esta acción no se puede deshacer.')) return
    await fetch('/api/ventas', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_oportunidad', id }) })
    reload()
  }

  // Filtros ventas
  const meses = Array.from(new Set(ventas.map(v => (v.fecha || '').slice(0, 7)).filter(Boolean))).sort().reverse()
  const filteredVentas = ventas.filter(v => {
    if (filterMes && !(v.fecha || '').startsWith(filterMes)) return false
    if (search && !v.nombre?.toLowerCase().includes(search.toLowerCase()) &&
        !(v.numero || '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Filtro oportunidades
  const filteredOps = ops.filter(o => !filterEtapa || o.etapa === filterEtapa)

  return (
    <div style={{ padding: 20 }}>

      {/* Tabs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          {(['ventas', 'oportunidades', 'cotizaciones', 'pendientes', 'devoluciones'] as const).map(t => (
            <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'ventas' ? '💰 Ventas' : t === 'oportunidades' ? '🎯 Oportunidades' : t === 'cotizaciones' ? '📄 Cotizaciones' : t === 'pendientes' ? '⏳ Pendientes de Pago' : '↩️ Devoluciones'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowGastoModal(true)}>
            💸 Gasto Operativo
          </button>
          <button className="btn btn-primary" onClick={() => { setEditVenta(null); setShowModal(true) }}>
            + Registrar Venta
          </button>
        </div>
      </div>

      {/* ── TAB VENTAS ── */}
      {tab === 'ventas' && (<>
        <KStrip items={[
          { label: 'Última Venta', value: fmtUSD(kpis.ultimaMonto), sub: kpis.ultimaCliente, color: 'var(--teal)' },
          { label: 'Venta del Día', value: fmtUSD(kpis.diaTotal), sub: `${kpis.diaItems} ventas hoy`, color: 'var(--green)' },
          { label: 'Venta Semanal', value: fmtUSD(kpis.semTotal), sub: `${kpis.semItems} ventas esta semana`, color: 'var(--blue)' },
          { label: 'Ventas del Mes', value: fmtUSD(kpis.mesTotal), sub: `${kpis.mesItems} ventas`, color: 'var(--purple)' },
        ]} />

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700 }}>📋 Historial de Ventas</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input placeholder="Buscar cliente / # venta..." value={search} onChange={e => setSearch(e.target.value)}
                style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)', minWidth: 180 }} />
              <select value={filterMes} onChange={e => setFilterMes(e.target.value)}
                style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
                <option value="">Todos los meses</option>
                {meses.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>#</th><th>Fecha</th><th>Cliente</th><th>Vendedor</th><th>Items</th><th>Monto</th>
                <th>Método</th><th>Estado</th><th>Canal</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {filteredVentas.slice(0, 50).map(v => (
                  <tr key={v.id}>
                    <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{v.numero ?? '–'}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{v.fecha}</td>
                    <td style={{ fontWeight: 600 }}>{v.nombre}</td>
                    <td style={{ fontSize: 11, color: 'var(--txt3)' }}>
                      {(v as { vendedor?: { nombre: string } }).vendedor?.nombre ?? <span style={{ opacity: .4 }}>—</span>}
                    </td>
                    <td className="mono" style={{ textAlign: 'center' }}>{(v.items?.length ?? 0)}</td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(v.monto)}</td>
                    <td style={{ fontSize: 11 }}>{v.metodo_pago ?? '–'}</td>
                    <td><EstadoBadge cobro={v.cobro} /></td>
                    <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{v.canal ?? '–'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {v.cobro === 'Liquidacion_Pendiente' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => confirmarLiquidacion(v.id)} title="Confirmar depósito">✅</button>
                        )}
                        {v.cobro !== 'Borrador' && (
                          <button className="btn btn-secondary btn-sm" onClick={() => setDteVenta(v)} title="Subir DTE y vincularlo a esta venta">📎</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditVenta(v); setShowModal(true) }}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteVenta(v.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredVentas.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin ventas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {/* ── TAB OPORTUNIDADES ── */}
      {tab === 'oportunidades' && (
        <div>
          <KStrip items={[
            { label: 'Abiertas',        value: String(opKpis.abiertas),    sub: fmtUSD(opKpis.valorPipeline) + ' en pipeline', color: 'var(--blue)'  },
            { label: 'Ganadas este mes', value: String(opKpis.ganadasMes), sub: fmtUSD(opKpis.ganadasMesMonto),  color: 'var(--green)' },
            { label: 'Perdidas este mes', value: String(opKpis.perdidasMes), sub: 'no convertidas este mes',    color: 'var(--red)'   },
            { label: 'Tasa de conversión', value: opKpis.tasaConversionMes + '%', sub: 'ganadas / cerradas (mes)', color: 'var(--teal)' },
            { label: 'Nuevas esta semana', value: String(opKpis.nuevasSemana), sub: `${opKpis.nuevasHoy} hoy · ${opKpis.nuevasMes} este mes`, color: 'var(--purple)' },
          ]} />
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>🎯 Oportunidades</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select value={filterEtapa} onChange={e => setFilterEtapa(e.target.value)}
                  style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '6px 10px', fontSize: 12, color: 'var(--txt)' }}>
                  <option value="">Todas las etapas</option>
                  {ETAPAS_OPORTUNIDAD.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <button className="btn btn-secondary" style={{ fontSize: 12 }}
                  onClick={() => { setEditOp(null); setShowOpModal(true) }}>
                  + Nueva Oportunidad
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>#</th><th>Fecha</th><th>Cliente</th><th>Etapa</th><th>Valor est.</th><th>Prob.</th>
                  <th>Próxima acción</th><th>Vendedor</th><th>Acción</th>
                </tr></thead>
                <tbody>
                  {filteredOps.map(o => (
                    <tr key={o.id}>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{o.numero ?? '–'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{(o.created_at ?? '').slice(0, 10)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {o.cliente}
                        {o.sector && <div style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 400 }}>{o.sector}</div>}
                      </td>
                      <td>
                        <span className={`badge badge-${ETAPA_COLOR[o.etapa] ?? 'gray'}`}>{o.etapa}</span>
                        {o.etapa === 'Perdida' && o.motivo_perdida && (
                          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2, maxWidth: 160 }}>{o.motivo_perdida}</div>
                        )}
                      </td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(o.valor_estimado)}</td>
                      <td className="mono" style={{ textAlign: 'center' }}>{o.probabilidad_pct}%</td>
                      <td style={{ fontSize: 11 }}>
                        {o.proxima_accion ?? <span style={{ opacity: .4 }}>—</span>}
                        {o.fecha_proxima_accion && <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{o.fecha_proxima_accion}</div>}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{o.vendedor?.nombre ?? <span style={{ opacity: .4 }}>—</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {(ETAPAS_OPORTUNIDAD_ABIERTAS as readonly string[]).includes(o.etapa) && (
                            <select
                              value=""
                              onChange={e => { const v = e.target.value; if (v) cambiarEtapaOportunidad(o, v as EtapaOportunidad) }}
                              style={{ fontSize: 10, background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', color: 'var(--txt)' }}>
                              <option value="">Mover a...</option>
                              {ETAPAS_OPORTUNIDAD.filter(e => e !== o.etapa).map(e => <option key={e} value={e}>{e}</option>)}
                            </select>
                          )}
                          {o.etapa !== 'Ganada' && o.etapa !== 'Perdida' && (
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 10 }}
                              onClick={() => { setCotPrefillOp(o); setEditCot(null); setShowCotModal(true) }}
                              title="Convertir a Cotización">📄</button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditOp(o); setShowOpModal(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteOportunidad(o.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredOps.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin oportunidades</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB COTIZACIONES ── */}
      {tab === 'cotizaciones' && (
        <div>
          <KStrip items={[
            { label: 'Total Cotizaciones', value: String(cotKpis.total),    sub: 'emitidas',           color: 'var(--blue)'   },
            { label: 'Enviadas',           value: String(cotKpis.enviadas), sub: 'esperando respuesta', color: 'var(--amber)'  },
            { label: 'Aprobadas',          value: String(cotKpis.aprobadas), sub: fmtUSD(cotKpis.aprobMonto), color: 'var(--green)' },
            { label: 'Rechazadas',         value: String(cotKpis.rechazadas), sub: 'no convertidas',   color: 'var(--red)'    },
            { label: 'Tasa Aprobación',    value: cotKpis.tasa + '%',       sub: 'aprobadas / cerradas', color: 'var(--teal)' },
          ]} />
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700 }}>📄 Cotizaciones</h3>
              <button className="btn btn-secondary" style={{ fontSize: 12 }}
                onClick={() => { setEditCot(null); setShowCotModal(true) }}>
                + Nueva Cotización
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Sector</th><th>Items</th><th>Total</th><th>Válida hasta</th><th>Estado</th><th>Acción</th></tr></thead>
                <tbody>
                  {cots.map(c => (
                    <tr key={c.id}>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{c.numero ?? '–'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{c.fecha_emision}</td>
                      <td style={{ fontWeight: 600 }}>{c.cliente}</td>
                      <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{c.sector ?? '–'}</td>
                      <td className="mono" style={{ textAlign: 'center' }}>{c.items?.length ?? 0}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(c.total)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{c.fecha_vence ?? '–'}</td>
                      <td><span className="badge badge-gray">{c.estado}</span></td>
                      <td>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => { setEditCot(c); setShowCotModal(true) }}>✏️</button>
                      </td>
                    </tr>
                  ))}
                  {cots.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin cotizaciones</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB PENDIENTES DE PAGO ── */}
      {tab === 'pendientes' && (
        <div>
          <KStrip items={[
            { label: 'Activos',    value: String(ppKpis.total),       sub: fmtUSD(ppKpis.totalMonto),    color: 'var(--teal)'  },
            { label: 'Vencidos',   value: String(ppKpis.vencidos),    sub: fmtUSD(ppKpis.vencidosMonto), color: 'var(--red)'   },
            { label: 'Esta Semana',value: String(ppKpis.semana),      sub: fmtUSD(ppKpis.semanaMonto),   color: 'var(--amber)' },
          ]} />
          <div className="card">
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>⏳ Pendientes de Pago</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>#</th><th>Fecha emisión</th><th>Cliente</th><th>Vence</th>
                  <th>Total</th><th>Días crédito</th><th>Estado</th><th>Acción</th>
                </tr></thead>
                <tbody>
                  {pps.map(pp => {
                    const vencido = pp.fecha_entrega && pp.fecha_entrega < hoy && pp.estado === 'Pendiente'
                    return (
                      <tr key={pp.id}>
                        <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{pp.numero ?? '–'}</td>
                        <td className="mono" style={{ fontSize: 11 }}>{pp.fecha_emision}</td>
                        <td style={{ fontWeight: 600 }}>{pp.cliente}</td>
                        <td className="mono" style={{ fontSize: 11, color: vencido ? 'var(--red)' : 'var(--txt)', fontWeight: vencido ? 700 : 400 }}>
                          {pp.fecha_entrega ?? '–'}
                        </td>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(pp.total)}</td>
                        <td style={{ fontSize: 11 }}>
                          {pp.condiciones_pago ?? '–'}
                          {pp.credito_50_50 && <span style={{ fontSize: 9, color: 'var(--amber)', marginLeft: 4 }}>50%+50%</span>}
                        </td>
                        <td>
                          <span className={`badge ${vencido ? 'badge-red' : pp.estado === 'Pagado' ? 'badge-green' : 'badge-amber'}`}>
                            {vencido ? 'Vencido' : pp.estado}
                          </span>
                        </td>
                        <td>
                          {pp.estado !== 'Pagado' && (
                            <button className="btn btn-primary btn-sm" onClick={() => pagarPP(pp.id)}
                              style={{ background: 'var(--green)', borderColor: 'var(--green)', fontSize: 11 }}>
                              💰 Pagado
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {pps.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin pendientes</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB DEVOLUCIONES ── */}
      {tab === 'devoluciones' && (
        <DevolucionesTab
          devoluciones={devoluciones}
          ventasDevolvibles={ventasDevolvibles as never}
          kpis={devKpis}
          mesActual={mesActual}
        />
      )}

      {/* Modal Cotización */}
      {showCotModal && (
        <CotizacionModal
          productos={productos}
          clientes={clientes}
          editCot={editCot}
          prefillOp={cotPrefillOp ? { id: cotPrefillOp.id, numero: cotPrefillOp.numero, cliente: cotPrefillOp.cliente, contacto: cotPrefillOp.contacto, telefono: cotPrefillOp.telefono, email: cotPrefillOp.email, sector: cotPrefillOp.sector } : undefined}
          onClose={() => { setShowCotModal(false); setEditCot(null); setCotPrefillOp(null) }}
          onSaved={() => { setShowCotModal(false); setEditCot(null); setCotPrefillOp(null); reload() }}
        />
      )}

      {/* Modal Oportunidad */}
      {showOpModal && (
        <OportunidadModal
          clientes={clientes}
          empleados={empleados}
          editOp={editOp}
          onClose={() => { setShowOpModal(false); setEditOp(null) }}
          onSaved={() => { setShowOpModal(false); setEditOp(null); reload() }}
        />
      )}

      {/* Modal Venta */}
      {showModal && (
        <VentaModal
          productos={productos}
          clientes={clientes}
          empleados={empleados}
          editVenta={editVenta}
          onClose={() => { setShowModal(false); setEditVenta(null) }}
          onSaved={() => { setShowModal(false); setEditVenta(null); reload() }}
        />
      )}

      {/* Modal Subir DTE (vinculado a una venta) */}
      {dteVenta && (
        <DteUploadModal
          venta={dteVenta}
          onClose={() => setDteVenta(null)}
          onSaved={() => { setDteVenta(null); reload() }}
        />
      )}

      {/* Modal Gasto Operativo Variable */}
      {showGastoModal && (
        <GastoVariableModal
          onClose={() => setShowGastoModal(false)}
          onSaved={() => setShowGastoModal(false)}
        />
      )}
    </div>
  )
}

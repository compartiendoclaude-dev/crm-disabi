'use client'
import React, { useState } from 'react'
import { createClient } from '@/lib/supabase'
import ProveedoresTab from './ProveedoresTab'
import { fmtUSD, today } from '@/lib/utils'
import type { Compra, Producto } from '@/lib/types'

interface ComprasKpis {
  importacionMes: number; localMes: number; enTransito: number
  recibidaMes: number; fleteAcum: number; impuestosAcum: number
}

interface GastoLocal { id: string; fecha: string; descripcion: string; monto: number; categoria?: string; proveedor?: string; factura?: string }

interface Props {
  compras: Compra[]
  gastosLocales: GastoLocal[]
  productos: Producto[]
  kpis: ComprasKpis
  proveedores: import('@/lib/types').Proveedor[]
  proveedoresTextoLibre: string[]
  comprasSinVincular: { id: string; proveedor: string; fecha: string; monto_final?: number; monto_total?: number }[]
  proveedoresKpis: { total: number; activos: number; locales: number; importacion: number; sinVincular: number }
}

const ESTADOS_COMPRA = ['Borrador', 'Pedido', 'En tránsito', 'Recibido', 'Cancelado']
const PARTIDAS = ['Materia Prima', 'Insumo', 'Empaque', 'Servicios', 'Logística', 'Otro']

const ESTADO_COLORS: Record<string, string> = {
  Borrador: 'gray', Pedido: 'blue', 'En tránsito': 'amber', Recibido: 'green', Cancelado: 'red',
}

// ── Modal Importación ─────────────────────────────────────────────────────────

// ─── MODAL: Importar factura/pedido desde PDF o Imagen (flujo aislado) ────────
function ImportarPdfModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  type ItemExtraido = { producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }

  const [step, setStep] = React.useState<'subir' | 'revisar'>('subir')
  const [leyendo, setLeyendo] = React.useState(false)
  const [error, setError] = React.useState('')
  const [items, setItems] = React.useState<ItemExtraido[]>([])
  const [proveedor, setProveedor] = React.useState('')
  const [fecha, setFecha] = React.useState(today())
  const [numero, setNumero] = React.useState('')
  const [fechaVence, setFechaVence] = React.useState('')
  const [generarGasto, setGenerarGasto] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [resultado, setResultado] = React.useState<{ numero: string; items_creados: number; productos_sin_match: number } | null>(null)

  async function handleFile(file: File) {
    setLeyendo(true); setError('')
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res((r.result as string).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const sb = createClient()
      const { data: productos } = await sb.from('disabi_productos')
        .select('id, codigo, nombre, costo_unitario')
        .eq('activo', true).order('nombre')

      const catalogo = (productos ?? [])
        .map(p => `- ${p.id} | ${p.codigo} | ${p.nombre} | $${p.costo_unitario ?? 0}`)
        .join('\n')

      const res = await fetch('/api/ocr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64: base64, mediaType: file.type, catalogo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al leer el documento')

      if (!data.items?.length) {
        setError('No se encontraron productos en el documento')
        return
      }

      setItems(data.items)
      if (data.proveedor) setProveedor(data.proveedor)
      if (data.fecha) setFecha(data.fecha)
      if (data.numero_factura) setNumero(data.numero_factura)
      setStep('revisar')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al procesar el archivo')
    } finally {
      setLeyendo(false)
    }
  }

  function actualizarItem(idx: number, campo: keyof ItemExtraido, valor: string | number) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const nuevo = { ...it, [campo]: valor }
      if (campo === 'cantidad' || campo === 'precio_unitario') {
        nuevo.subtotal = parseFloat((Number(nuevo.cantidad) * Number(nuevo.precio_unitario)).toFixed(2))
      }
      return nuevo
    }))
  }

  function eliminarItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const totalGeneral = items.reduce((a, i) => a + i.subtotal, 0)

  async function confirmar() {
    if (!proveedor.trim()) return setError('El proveedor es requerido')
    if (!items.length) return setError('Agrega al menos un producto')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'crear_importacion_ocr',
          proveedor, fecha, numero: numero || undefined,
          items, generar_gasto: generarGasto,
          fecha_vence_pago: fechaVence || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResultado(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (resultado) {
    return (
      <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onSaved()}>
        <div className="modal-box" style={{ maxWidth: 480, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h3 style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Importación {resultado.numero} creada</h3>
          <p style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 4 }}>
            {resultado.items_creados} items registrados
          </p>
          {resultado.productos_sin_match > 0 && (
            <p style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 16 }}>
              ⚠️ {resultado.productos_sin_match} producto(s) sin match en el catálogo — no afectaron el stock, revísalos manualmente
            </p>
          )}
          <button className="btn btn-primary" onClick={onSaved} style={{ marginTop: 12 }}>Cerrar</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 780 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>📄 Importar desde PDF o Imagen</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {step === 'subir' && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>{leyendo ? '⏳' : '📤'}</div>
            <p style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 20 }}>
              {leyendo ? 'Leyendo documento con IA, puede tardar unos segundos...' : 'Sube la factura o el pedido en PDF o como imagen'}
            </p>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 'var(--r)',
              background: leyendo ? 'var(--surf2)' : 'var(--indigo)',
              color: leyendo ? 'var(--txt3)' : '#fff',
              fontSize: 13, fontWeight: 600,
              cursor: leyendo ? 'not-allowed' : 'pointer',
            }}>
              {leyendo ? 'Procesando...' : '📎 Seleccionar archivo'}
              <input
                type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                disabled={leyendo}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              />
            </label>
          </div>
        )}

        {step === 'revisar' && (
          <>
            <div className="grid-3" style={{ marginBottom: 16 }}>
              <div className="field">
                <label>Proveedor <span className="req">*</span></label>
                <input value={proveedor} onChange={e => setProveedor(e.target.value)} />
              </div>
              <div className="field">
                <label>Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
              <div className="field">
                <label>N° Orden/Factura</label>
                <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Autogenerado si se deja vacío" />
              </div>
              <div className="field">
                <label>Fecha vencimiento pago (opcional)</label>
                <input type="date" value={fechaVence} onChange={e => setFechaVence(e.target.value)} />
              </div>
              <div className="field" style={{ justifyContent: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={generarGasto} onChange={e => setGenerarGasto(e.target.checked)} style={{ width: 16, height: 16 }} />
                <label style={{ marginBottom: 0 }}>Registrar como gasto (costo de ventas)</label>
              </div>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>
              Items detectados — revisa y corrige antes de confirmar
            </div>
            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--bdr)', borderRadius: 'var(--r)' }}>
              <table className="tbl">
                <thead>
                  <tr><th>Producto</th><th>Match catálogo</th><th>Cant.</th><th>Precio</th><th>Subtotal</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 160 }}>
                        <input value={item.descripcion} onChange={e => actualizarItem(i, 'descripcion', e.target.value)}
                          style={{ width: '100%', border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                      </td>
                      <td>
                        {item.producto_id
                          ? <span style={{ fontSize: 10, color: 'var(--green)' }}>✅ vinculado</span>
                          : <span style={{ fontSize: 10, color: 'var(--amber)' }}>⚠️ sin match</span>}
                      </td>
                      <td>
                        <input type="number" value={item.cantidad} onChange={e => actualizarItem(i, 'cantidad', Number(e.target.value))}
                          style={{ width: 60, border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                      </td>
                      <td>
                        <input type="number" step="0.01" value={item.precio_unitario} onChange={e => actualizarItem(i, 'precio_unitario', Number(e.target.value))}
                          style={{ width: 70, border: '1px solid var(--bdr)', borderRadius: 4, padding: '3px 6px', fontSize: 12 }} />
                      </td>
                      <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(item.subtotal)}</td>
                      <td>
                        <button onClick={() => eliminarItem(i)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--bdr)' }}>
                    <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700, padding: '8px 12px' }}>TOTAL</td>
                    <td className="mono" style={{ fontWeight: 800, color: 'var(--teal)' }}>{fmtUSD(totalGeneral)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setStep('subir')}>← Subir otro archivo</button>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
                <button className="btn btn-primary" onClick={confirmar} disabled={saving}>
                  {saving ? '⏳ Guardando...' : `💾 Confirmar e importar (${items.length} items)`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ImportacionModal({ productos: prodsProp, edit, onClose, onSaved }: {
  productos: Producto[]; edit: Compra | null; onClose: () => void; onSaved: () => void
}) {
  const [productos, setProductos] = React.useState<Producto[]>(prodsProp)
  const [prodError, setProdError] = React.useState('')
  const [prodLoading, setProdLoading] = React.useState(true)

  // Cargar productos directamente desde Supabase (cliente browser)
  React.useEffect(() => {
    const sb = createClient()
    sb.from('disabi_productos')
      .select('id, codigo, nombre, costo_unitario, precio_venta, stock_actual, categoria')
      .eq('activo', true)
      .order('nombre')
      .then(({ data, error }) => {
        setProdLoading(false)
        if (error) { setProdError(error.message); return }
        if (data?.length) { setProductos(data as unknown as typeof productos); setProdError('') }
        else setProdError('0 productos activos encontrados en el catálogo')
      })
  }, [])

  const [proveedor,   setProveedor]   = useState(edit?.proveedor ?? '')
  const [fecha,       setFecha]       = useState(edit?.fecha ?? today())
  const [fechaRec,    setFechaRec]    = useState((edit as unknown as { fecha_recepcion?: string })?.fecha_recepcion ?? '')
  const [numero,      setNumero]      = useState(edit?.numero ?? '')
  const [moneda,      setMoneda]      = useState((edit as unknown as { moneda?: string })?.moneda ?? 'USD')
  const [tipoCambio,  setTipoCambio]  = useState((edit as unknown as { tipo_cambio?: number })?.tipo_cambio ?? 1)
  const [estado, setEstado] = useState<string>(edit?.estado ?? 'Pedido')
  const [flete,       setFlete]       = useState((edit as unknown as { flete?: number })?.flete ?? 0)
  const [impuestos,   setImpuestos]   = useState((edit as unknown as { impuestos?: number })?.impuestos ?? 0)
  const [items,       setItems]       = useState<{ producto_id?: string; descripcion: string; cantidad: number; precio_unitario: number; subtotal: number }[]>([])
  const [selProd,     setSelProd]     = useState('')

  // Cargar items existentes al editar
  React.useEffect(() => {
    if (!edit?.id) return
    const sb = createClient()
    sb.from('disabi_compra_items')
      .select('id, producto_id, descripcion, cantidad, costo_unitario, subtotal, producto:disabi_productos(nombre, codigo)')
      .eq('compra_id', edit.id)
      .order('id')
      .then(({ data }) => {
        if (data?.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setItems((data as any[]).map((i: any) => ({
            producto_id:     i.producto_id ?? undefined,
            descripcion:     (Array.isArray(i.producto) ? i.producto[0]?.nombre : i.producto?.nombre) ?? i.descripcion ?? 'Producto',
            cantidad:        i.cantidad,
            precio_unitario: i.costo_unitario,
            subtotal:        i.subtotal,
          })))
        }
      })
  }, [edit?.id])
  const [qty,         setQty]         = useState(1)
  const [precio,      setPrecio]      = useState(0)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const subtotal   = items.reduce((a, i) => a + i.subtotal, 0)
  const montoFinal = subtotal + flete + impuestos

  function addItem() {
    if (!precio || precio <= 0) return
    const prod = productos.find(p => p.id === selProd)
    const sub  = parseFloat((precio * qty).toFixed(2))
    setItems(prev => [...prev, {
      producto_id: selProd || undefined,
      descripcion: prod?.nombre ?? 'Producto',
      cantidad: qty, precio_unitario: precio, subtotal: sub,
    }])
    setSelProd(''); setPrecio(0); setQty(1)
  }

  async function handleSave() {
    if (!proveedor.trim() || !fecha) return setError('Proveedor y fecha son requeridos')
    if (!items.length) return setError('Agrega al menos un item')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/compras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_importacion', editId: edit?.id,
          proveedor, fecha, fecha_recepcion: fechaRec || null, numero,
          moneda, tipo_cambio: tipoCambio, estado, flete, impuestos, items,
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
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Importación' : '🌐 Nueva Importación'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-3" style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Proveedor <span className="req">*</span></label>
            <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor" />
          </div>
          <div className="field">
            <label>Estado</label>
            <select value={estado} onChange={e => setEstado(e.target.value)}>
              {ESTADOS_COMPRA.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Fecha de orden <span className="req">*</span></label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha de recepción</label>
            <input type="date" value={fechaRec} onChange={e => setFechaRec(e.target.value)} />
          </div>
          <div className="field">
            <label># Orden / Factura</label>
            <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="IMP-001" />
          </div>
          <div className="field">
            <label>Moneda</label>
            <select value={moneda} onChange={e => setMoneda(e.target.value)}>
              <option value="USD">USD</option><option value="GTQ">GTQ</option><option value="EUR">EUR</option>
            </select>
          </div>
          <div className="field">
            <label>Tipo de cambio</label>
            <input type="number" min="1" step="0.01" value={tipoCambio} onChange={e => setTipoCambio(parseFloat(e.target.value) || 1)} />
          </div>
          <div className="field">
            <label>Flete ($)</label>
            <input type="number" min="0" step="0.01" value={flete || ''} onChange={e => setFlete(parseFloat(e.target.value) || 0)} />
          </div>
          <div className="field">
            <label>Impuestos DAI/IVA ($)</label>
            <input type="number" min="0" step="0.01" value={impuestos || ''} onChange={e => setImpuestos(parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        {/* Items */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>📦 Items de la compra</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
            <div className="field" style={{ flex: '1 1 180px' }}>
              <label>Producto</label>
              <select value={selProd} onChange={e => { setSelProd(e.target.value); const p = productos.find(x => x.id === e.target.value); if (p) setPrecio((p as unknown as { costo_unitario?: number }).costo_unitario ?? 0) }}>
                <option value="">— Seleccionar —</option>
                {productos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
              {prodLoading && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>⏳ Cargando catálogo...</div>}
              {!prodLoading && prodError && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠️ {prodError}</div>}
              {!prodLoading && !prodError && productos.length === 0 && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>⚠️ Catálogo vacío</div>}
            </div>
            <div className="field" style={{ flex: '0 0 70px' }}>
              <label>Cant.</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(parseInt(e.target.value) || 1)} />
            </div>
            <div className="field" style={{ flex: '0 0 100px' }}>
              <label>Precio unit.</label>
              <input type="number" min="0" step="0.01" value={precio || ''} onChange={e => setPrecio(parseFloat(e.target.value) || 0)} />
            </div>
            <button className="btn btn-secondary" onClick={addItem} style={{ marginBottom: 2 }}>+ Agregar</button>
          </div>
          {items.length > 0 && (
            <table className="tbl">
              <thead><tr><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th><th></th></tr></thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.descripcion}</td>
                    <td className="mono">{item.cantidad}</td>
                    <td className="mono">{fmtUSD(item.precio_unitario)}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(item.subtotal)}</td>
                    <td><button onClick={() => setItems(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {items.length > 0 && (
            <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--surf2)', borderRadius: 'var(--r)', fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span>Subtotal</span><span className="mono">{fmtUSD(subtotal)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: 'var(--txt3)' }}>Flete</span><span className="mono">{fmtUSD(flete)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}><span style={{ color: 'var(--txt3)' }}>Impuestos</span><span className="mono">{fmtUSD(impuestos)}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 14, borderTop: '1px solid var(--bdr)', paddingTop: 6, marginTop: 4 }}>
                <span>TOTAL</span><span className="mono" style={{ color: 'var(--teal)' }}>{fmtUSD(montoFinal)}</span>
              </div>
            </div>
          )}
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

// ── Modal Compra Local ─────────────────────────────────────────────────────────
function CompraLocalModal({ edit, onClose, onSaved }: {
  edit: GastoLocal | null; onClose: () => void; onSaved: () => void
}) {
  const [fecha,     setFecha]     = useState(edit?.fecha ?? today())
  const [proveedor, setProveedor] = useState(edit?.proveedor ?? '')
  const [desc,      setDesc]      = useState(edit?.descripcion ?? '')
  const [monto,     setMonto]     = useState(edit?.monto ?? 0)
  const [partida,   setPartida]   = useState(edit?.categoria ?? 'Materia Prima')
  const [factura,   setFactura]   = useState(edit?.factura ?? '')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  async function handleSave() {
    if (!fecha || !proveedor.trim() || !desc.trim() || !monto) return setError('Todos los campos son requeridos')
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/compras', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_compra_local', editId: edit?.id, fecha, proveedor, descripcion: desc, monto, partida, numero_factura: factura }),
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
          <h3 style={{ fontWeight: 800, fontSize: 15 }}>{edit ? '✏️ Editar Compra Local' : '🏪 Nueva Compra Local'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>}

        <div className="grid-2" style={{ marginBottom: 12 }}>
          <div className="field"><label>Fecha <span className="req">*</span></label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          <div className="field"><label>Proveedor <span className="req">*</span></label><input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor" /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><label>Descripción <span className="req">*</span></label><input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Qué se compró..." /></div>
          <div className="field"><label>Monto ($) <span className="req">*</span></label><input type="number" min="0" step="0.01" value={monto || ''} onChange={e => setMonto(parseFloat(e.target.value) || 0)} /></div>
          <div className="field"><label>Partida contable</label><select value={partida} onChange={e => setPartida(e.target.value)}>{PARTIDAS.map(p => <option key={p}>{p}</option>)}</select></div>
          <div className="field"><label># Factura</label><input value={factura} onChange={e => setFactura(e.target.value)} placeholder="F-001" /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '⏳ Guardando...' : '💾 Guardar'}</button>
        </div>
      </div>
    </div>
  )
}

// ── MÓDULO PRINCIPAL ──────────────────────────────────────────────────────────
export default function ComprasModule({ compras: initialCompras, gastosLocales: initialLocales, productos, kpis, proveedores, proveedoresTextoLibre, comprasSinVincular, proveedoresKpis }: Props) {
  const [tab,      setTab]      = useState<'importaciones' | 'locales' | 'proveedores'>('importaciones')
  const [compras]  = useState(initialCompras)
  const [locales]  = useState(initialLocales)
  const [showImp,  setShowImp]  = useState(false)
  const [showImportarPdf, setShowImportarPdf] = useState(false)
  const [editImp,  setEditImp]  = useState<Compra | null>(null)
  const [showLoc,  setShowLoc]  = useState(false)
  const [editLoc,  setEditLoc]  = useState<GastoLocal | null>(null)

  function reload() { window.location.reload() }

  async function cambiarEstado(id: string, estado: string) {
    const fechaRec = estado === 'Recibido' ? prompt('Fecha de recepción (YYYY-MM-DD):', today()) : null
    await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_estado_compra', id, estado, fecha_recepcion: fechaRec }) })
    reload()
  }

  async function deleteCompra(id: string, tabla: string) {
    if (!confirm('¿Eliminar este registro?')) return
    await fetch('/api/compras', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_compra', id, tabla }) })
    reload()
  }

  return (
    <div style={{ padding: 20 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Importaciones Mes',  value: fmtUSD(kpis.importacionMes), color: 'var(--blue)'   },
          { label: 'Compras Locales Mes',value: fmtUSD(kpis.localMes),       color: 'var(--purple)' },
          { label: 'En Tránsito',        value: String(kpis.enTransito),      color: 'var(--amber)'  },
          { label: 'Recibidas Mes',      value: String(kpis.recibidaMes),     color: 'var(--green)'  },
          { label: 'Flete Acumulado',    value: fmtUSD(kpis.fleteAcum),       color: 'var(--teal)'   },
          { label: 'Impuestos Importación', value: fmtUSD(kpis.impuestosAcum), color: 'var(--red)'  },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 18 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs + acciones */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div className="tab-bar" style={{ marginBottom: 0 }}>
          <button className={`tab-btn${tab === 'importaciones' ? ' active' : ''}`} onClick={() => setTab('importaciones')}>🌐 Importaciones</button>
          <button className={`tab-btn${tab === 'locales'       ? ' active' : ''}`} onClick={() => setTab('locales')}>🏪 Compras Locales</button>
          <button className={`tab-btn${tab === 'proveedores'   ? ' active' : ''}`} onClick={() => setTab('proveedores')}>🏭 Proveedores</button>
        </div>
        {tab === 'importaciones'
          ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowImportarPdf(true)}>📄 Importar desde PDF/Imagen</button>
              <button className="btn btn-primary" onClick={() => { setEditImp(null); setShowImp(true) }}>+ Nueva Importación Manual</button>
            </div>
          )
          : <button className="btn btn-primary" onClick={() => { setEditLoc(null); setShowLoc(true) }}>+ Nueva Compra Local</button>
        }
      </div>

      {/* ── TAB IMPORTACIONES ── */}
      {tab === 'importaciones' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th># Orden</th><th>Proveedor</th><th>Fecha</th><th>Recepción</th>
                <th>Flete</th><th>Impuestos</th><th>Total</th><th>Estado</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {compras.map(c => {
                  const total = (c as unknown as { monto_final?: number }).monto_final ?? c.total ?? 0
                  return (
                    <tr key={c.id}>
                      <td className="mono" style={{ fontSize: 10, color: 'var(--txt3)' }}>{c.numero ?? '–'}</td>
                      <td style={{ fontWeight: 600 }}>{c.proveedor}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{c.fecha}</td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--txt3)' }}>{(c as unknown as { fecha_recepcion?: string }).fecha_recepcion ?? '–'}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtUSD((c as unknown as { flete?: number }).flete ?? 0)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtUSD((c as unknown as { impuestos?: number }).impuestos ?? 0)}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(total)}</td>
                      <td>
                        <span className={`badge badge-${ESTADO_COLORS[c.estado ?? ''] ?? 'gray'}`}>
                          {c.estado ?? '–'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {c.estado !== 'Recibido' && c.estado !== 'Cancelado' && (
                            <button className="btn btn-secondary btn-sm" onClick={() => cambiarEstado(c.id, 'Recibido')} style={{ fontSize: 10 }}>✅ Recibir</button>
                          )}
                          <button className="btn btn-secondary btn-sm" onClick={() => { setEditImp(c); setShowImp(true) }}>✏️</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteCompra(c.id, 'compras')}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {compras.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin importaciones registradas</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB COMPRAS LOCALES ── */}
      {tab === 'locales' && (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Fecha</th><th>Proveedor</th><th>Descripción</th><th>Partida</th><th>Monto</th><th>Factura</th><th>Acción</th>
              </tr></thead>
              <tbody>
                {locales.map(g => (
                  <tr key={g.id}>
                    <td className="mono" style={{ fontSize: 11 }}>{g.fecha}</td>
                    <td style={{ fontWeight: 600, fontSize: 12 }}>{g.proveedor ?? '–'}</td>
                    <td style={{ fontSize: 12 }}>{g.descripcion}</td>
                    <td><span className="badge badge-gray">{g.categoria ?? '–'}</span></td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--teal)' }}>{fmtUSD(g.monto)}</td>
                    <td style={{ fontSize: 11, color: 'var(--txt3)' }}>{g.factura ?? '–'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditLoc(g); setShowLoc(true) }}>✏️</button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteCompra(g.id, 'gastos')}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {locales.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>Sin compras locales registradas</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB PROVEEDORES ── */}
      {tab === 'proveedores' && (
        <ProveedoresTab
          proveedores={proveedores as never}
          proveedoresTextoLibre={proveedoresTextoLibre}
          comprasSinVincular={comprasSinVincular}
          kpis={proveedoresKpis}
        />
      )}

      {showImp && <ImportacionModal productos={productos} edit={editImp} onClose={() => { setShowImp(false); setEditImp(null) }} onSaved={() => { setShowImp(false); setEditImp(null); reload() }} />}
      {showImportarPdf && <ImportarPdfModal onClose={() => setShowImportarPdf(false)} onSaved={() => { setShowImportarPdf(false); reload() }} />}
      {showLoc && <CompraLocalModal edit={editLoc} onClose={() => { setShowLoc(false); setEditLoc(null) }} onSaved={() => { setShowLoc(false); setEditLoc(null); reload() }} />}
    </div>
  )
}

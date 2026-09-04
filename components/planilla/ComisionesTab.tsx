'use client'
import { useState } from 'react'
import { fmtUSD } from '@/lib/utils'
import { PLANILLA } from '@/lib/constants'
import type { Empleado, ComisionRegistro } from '@/lib/types'

interface LineaCalculo {
  rango_id?: string
  categoria: string
  precio_iva_desc: string
  precio_sin_iva: number
  pct_comision: number
  cantidad_vendida: number
  comision_linea: number
}

interface Preview {
  empleado_nombre: string
  tipo_calculo: 'empleado' | 'honorarios'
  periodo: string
  fecha_pago_prog: string
  comision_bruta: number
  retencion_isr: number
  comision_neta: number
  pct_retencion: string
  bloqueado: boolean
  lineas: LineaCalculo[]
}

interface Props {
  empleados: Empleado[]
  comisiones: ComisionRegistro[]
  mesActual: string
}

const CATEGORIA_ICONS: Record<string, string> = {
  'Saborizantes':               '🧴',
  'Dispensadores Saborizantes': '🔧',
  'Salsas':                     '🌶️',
  'Dispensadores Salsas':       '🔩',
  'Cafe':                       '☕',
}

export default function ComisionesTab({ empleados, comisiones: initialComisiones, mesActual }: Props) {
  const [comisiones,  setComisiones]  = useState(initialComisiones)
  const [empId,       setEmpId]       = useState('')
  const [periodo,     setPeriodo]     = useState(mesActual)
  const [preview,     setPreview]     = useState<Preview | null>(null)
  const [calculando,  setCalculando]  = useState(false)
  const [guardando,   setGuardando]   = useState(false)
  const [error,       setError]       = useState('')
  const [success,     setSuccess]     = useState('')

  const emp = empleados.find(e => e.id === empId)
  const tipoContrato = (emp as { tipo_contrato?: string })?.tipo_contrato ?? 'honorarios'

  // KPIs del período actual
  const comsPeriodo = comisiones.filter(c => c.periodo === periodo)
  const totalBruto  = comsPeriodo.reduce((a, c) => a + c.comision_bruta, 0)
  const totalISR    = comsPeriodo.reduce((a, c) => a + c.retencion_isr, 0)
  const totalNeto   = comsPeriodo.reduce((a, c) => a + c.comision_neta, 0)
  const pendientes  = comsPeriodo.filter(c => c.estado === 'Pendiente').length
  const bloqueados  = comsPeriodo.filter(c => c.estado === 'Bloqueado').length

  async function handleCalcular() {
    if (!empId) return setError('Selecciona un vendedor')
    setCalculando(true); setError(''); setPreview(null)
    try {
      const res = await fetch('/api/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'calcular_comision', empleado_id: empId, periodo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPreview(data.preview)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al calcular')
    } finally { setCalculando(false) }
  }

  async function handleGuardar() {
    if (!preview) return
    setGuardando(true); setError(''); setSuccess('')
    try {
      const res = await fetch('/api/comisiones', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_comision',
          empleado_id: empId, periodo,
          comision_bruta:   preview.comision_bruta,
          retencion_isr:    preview.retencion_isr,
          comision_neta:    preview.comision_neta,
          tipo_calculo:     preview.tipo_calculo,
          fecha_pago_prog:  preview.fecha_pago_prog,
          bloqueado:        preview.bloqueado,
          lineas:           preview.lineas,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSuccess(`✅ Comisión de ${preview.empleado_nombre} guardada para ${periodo}`)
      setPreview(null)
      window.location.reload()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally { setGuardando(false) }
  }

  async function pagarComision(id: string, nombre: string) {
    const fechaPago = prompt(`Fecha de pago para comisión de ${nombre} (YYYY-MM-DD):`,
      new Date().toISOString().slice(0, 10))
    if (!fechaPago) return
    await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pagar_comision', id, fecha_pago_real: fechaPago }),
    })
    window.location.reload()
  }

  async function deleteComision(id: string) {
    if (!confirm('¿Eliminar este registro de comisión?')) return
    await fetch('/api/comisiones', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_comision', id }),
    })
    setComisiones(c => c.filter(x => x.id !== id))
  }

  return (
    <div style={{ padding: '0 0 20px' }}>

      {/* KPIs del período */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Comisión Bruta',   value: fmtUSD(totalBruto),  color: 'var(--teal)',   sub: `período ${periodo}` },
          { label: 'Retención ISR',    value: fmtUSD(totalISR),    color: 'var(--red)',    sub: 'descontado' },
          { label: 'Comisión Neta',    value: fmtUSD(totalNeto),   color: 'var(--green)',  sub: 'a pagar' },
          { label: 'Pendientes',       value: String(pendientes),  color: 'var(--amber)',  sub: 'por pagar' },
          { label: 'Bloqueados',       value: String(bloqueados),  color: 'var(--red)',    sub: 'crédito pendiente' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 16 }}>{k.value}</div>
            <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Calculadora */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 12 }}>
          🧮 Calcular Comisión
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label>Vendedor <span className="req">*</span></label>
            <select value={empId} onChange={e => { setEmpId(e.target.value); setPreview(null) }}>
              <option value="">— Seleccionar —</option>
              {empleados.filter(e => e.activo !== false).map(e => (
                <option key={e.id} value={e.id}>
                  {e.nombre} — {(e as { tipo_contrato?: string }).tipo_contrato === 'empleado' ? 'Empleado' : 'Honorarios'}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 0 140px' }}>
            <label>Período</label>
            <input type="month" value={periodo} onChange={e => { setPeriodo(e.target.value); setPreview(null) }} />
          </div>
          <button className="btn btn-primary" onClick={handleCalcular} disabled={calculando || !empId}
            style={{ marginBottom: 2 }}>
            {calculando ? '⏳ Calculando...' : '⚡ Calcular'}
          </button>
        </div>

        {/* Indicador de tipo de retención */}
        {empId && (
          <div style={{
            background: tipoContrato === 'honorarios' ? 'rgba(217,119,6,.08)' : 'rgba(8,145,178,.08)',
            border: `1px solid ${tipoContrato === 'honorarios' ? 'rgba(217,119,6,.25)' : 'rgba(8,145,178,.25)'}`,
            borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 11,
            color: tipoContrato === 'honorarios' ? 'var(--amber)' : 'var(--teal)',
            marginBottom: preview ? 12 : 0,
          }}>
            {tipoContrato === 'honorarios'
              ? `⚠️ ${emp?.nombre} está registrado como Servicios Profesionales. Se aplicará retención ISR del ${PLANILLA.RETENCION_HONORARIOS * 100}% (Art. 156 LISR).`
              : `ℹ️ ${emp?.nombre} está en planilla como empleado. Se aplicará retención ISR según tabla progresiva (Art. 154 LISR).`
            }
          </div>
        )}

        {/* Preview de cálculo */}
        {preview && (
          <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 14 }}>
            {preview.bloqueado && (
              <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>
                🔒 <strong>Comisión bloqueada</strong> — Existen cuentas por cobrar (CxC) pendientes. Según los términos y condiciones, no se puede pagar comisión hasta regularizar el crédito.
              </div>
            )}

            {/* Advertencia modo legacy — vendedor_id no asignado en las ventas */}
            {(preview as { modo_legacy?: boolean }).modo_legacy && (
              <div style={{ background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--amber)', marginBottom: 12 }}>
                ⚠️ <strong>Modo histórico</strong> — Las ventas de este período no tienen vendedor asignado. La comisión se calculó sobre el total de ventas del negocio, no sobre las ventas individuales de {preview.empleado_nombre}. Para comisiones precisas, asigna vendedor en cada venta.
              </div>
            )}

            {/* Líneas de detalle */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>
                Detalle por categoría y rango
              </div>
              <table className="tbl">
                <thead><tr>
                  <th>Categoría</th><th>Rango de precio (IVA)</th>
                  <th>Precio sin IVA</th><th>% Comisión</th>
                  <th>Cant. vendida</th><th>Comisión</th>
                </tr></thead>
                <tbody>
                  {preview.lineas.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--txt3)' }}>
                      Sin ventas comisionables en el período {periodo}
                    </td></tr>
                  ) : preview.lineas.map((l, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>
                        {CATEGORIA_ICONS[l.categoria] ?? '📦'} {l.categoria}
                      </td>
                      <td style={{ fontSize: 11 }}>{l.precio_iva_desc}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{fmtUSD(l.precio_sin_iva)}</td>
                      <td className="mono" style={{ color: 'var(--teal)' }}>{(l.pct_comision * 100).toFixed(1)}%</td>
                      <td className="mono" style={{ textAlign: 'center', fontWeight: 700 }}>{l.cantidad_vendida}</td>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtUSD(l.comision_linea)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Resumen de liquidación */}
            <div style={{ background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--r)', padding: '12px 16px', maxWidth: 400, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 10 }}>
                Liquidación — {preview.empleado_nombre}
              </div>
              {[
                { label: 'Comisión bruta',              value: fmtUSD(preview.comision_bruta), color: 'var(--teal)'  },
                { label: `Retención ISR (${preview.pct_retencion})`, value: `(${fmtUSD(preview.retencion_isr)})`, color: 'var(--red)' },
                { label: 'Comisión neta a pagar',        value: fmtUSD(preview.comision_neta), color: 'var(--green)', bold: true },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--bdr)', fontSize: 12 }}>
                  <span style={{ color: 'var(--txt2)', fontWeight: r.bold ? 700 : 400 }}>{r.label}</span>
                  <span className="mono" style={{ fontWeight: r.bold ? 800 : 600, color: r.color }}>{r.value}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8 }}>
                📅 Fecha de pago programada: <strong>{preview.fecha_pago_prog}</strong> (2do lunes hábil)
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, fontStyle: 'italic' }}>
                Tipo de retención: {preview.tipo_calculo === 'honorarios' ? 'Servicios profesionales — 10% ISR fijo (Art. 156 LISR)' : 'Empleado en planilla — Tabla progresiva ISR (Art. 154 LISR)'}
              </div>
            </div>

            {error && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
            {success && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--green)', marginBottom: 10 }}>{success}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={() => setPreview(null)}>✕ Descartar</button>
              <button className="btn btn-primary" onClick={handleGuardar} disabled={guardando}>
                {guardando ? '⏳ Guardando...' : '💾 Guardar comisión'}
              </button>
            </div>
          </div>
        )}

        {error && !preview && <div style={{ background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--red)', marginTop: 10 }}>{error}</div>}
        {success && !preview && <div style={{ background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, color: 'var(--green)', marginTop: 10 }}>{success}</div>}
      </div>

      {/* Tabla de comisiones guardadas */}
      <div className="card">
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 12 }}>
          📋 Registro de Comisiones — {periodo}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>Vendedor</th><th>Tipo</th><th>Comisión Bruta</th>
              <th>Retención ISR</th><th>Comisión Neta</th>
              <th>Fecha pago prog.</th><th>Estado</th><th>Acción</th>
            </tr></thead>
            <tbody>
              {comisiones.filter(c => c.periodo === periodo).map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>
                    {(c.empleado as { nombre?: string })?.nombre ?? '–'}
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                      {(c.empleado as { cargo?: string })?.cargo ?? ''}
                    </div>
                  </td>
                  <td>
                    {c.tipo_calculo === 'honorarios'
                      ? <span className="badge badge-amber">Honorarios</span>
                      : <span className="badge badge-blue">Empleado</span>
                    }
                  </td>
                  <td className="mono" style={{ fontWeight: 700 }}>{fmtUSD(c.comision_bruta)}</td>
                  <td className="mono" style={{ color: 'var(--red)' }}>
                    ({fmtUSD(c.retencion_isr)})
                    <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                      {c.tipo_calculo === 'honorarios' ? '10% fijo' : 'Tabla ISR'}
                    </div>
                  </td>
                  <td className="mono" style={{ fontWeight: 800, color: 'var(--green)' }}>{fmtUSD(c.comision_neta)}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.fecha_pago_prog ?? '–'}</td>
                  <td>
                    <span className={`badge ${
                      c.estado === 'Pagado'   ? 'badge-green' :
                      c.estado === 'Bloqueado'? 'badge-red' : 'badge-amber'
                    }`}>
                      {c.estado === 'Bloqueado' ? '🔒 Bloqueado' : c.estado}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {c.estado === 'Pendiente' && (
                        <button className="btn btn-primary btn-sm"
                          style={{ background: 'var(--green)', borderColor: 'var(--green)', fontSize: 10 }}
                          onClick={() => pagarComision(c.id, (c.empleado as { nombre?: string })?.nombre ?? '')}>
                          💰 Pagar
                        </button>
                      )}
                      <button className="btn btn-danger btn-sm" onClick={() => deleteComision(c.id)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
              {comisiones.filter(c => c.periodo === periodo).length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--txt3)' }}>
                  Sin comisiones calculadas para {periodo}. Usa el calculador de arriba para generar los registros.
                </td></tr>
              )}
            </tbody>
            {comisiones.filter(c => c.periodo === periodo).length > 0 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--bdr)', fontWeight: 800 }}>
                  <td colSpan={2} style={{ padding: '10px 12px' }}>TOTALES</td>
                  <td className="mono">{fmtUSD(totalBruto)}</td>
                  <td className="mono" style={{ color: 'var(--red)' }}>({fmtUSD(totalISR)})</td>
                  <td className="mono" style={{ color: 'var(--green)' }}>{fmtUSD(totalNeto)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Términos y condiciones */}
      <div style={{ marginTop: 12, background: 'var(--surf2)', borderRadius: 'var(--r)', padding: '10px 14px', fontSize: 11, color: 'var(--txt3)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--txt2)' }}>Términos y condiciones:</strong>
        <ul style={{ marginTop: 4, paddingLeft: 16 }}>
          <li>El pago se realiza el <strong>segundo lunes hábil del mes</strong>. Si es asueto, se mueve al siguiente día hábil.</li>
          <li>Se aplica <strong>descuento de renta</strong> al pago de comisión (10% honorarios / tabla progresiva empleados).</li>
          <li>Para que una comisión pueda ser pagada, <strong>no debe haber crédito pendiente del cliente</strong>.</li>
          <li>El período va del día 1 al último día calendario del mes.</li>
          <li>Los pedidos devueltos o no recibidos no se incluyen en el conteo comisionable.</li>
        </ul>
      </div>
    </div>
  )
}

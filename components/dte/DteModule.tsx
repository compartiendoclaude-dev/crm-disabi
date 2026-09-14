'use client'
import { useState, useCallback, useRef, useEffect } from 'react'
import ImportMasivaZip from './ImportMasivaZip'
import { fmtUSD } from '@/lib/utils'
import type { DTE } from '@/lib/types'
import { TIPO_DTE_LABEL } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface VentaSimple { id: string; numero?: string; nombre: string; fecha: string; monto: number }
interface ResumenMes  { mes: string; cantidad: number; total: number }
interface ResumenTipo { tipo: string; cantidad: number; total: number }
interface Kpis {
  total: number; totalPagar: number
  mesCantidad: number; mesPagar: number
  fcf: number; ccf: number; nc: number; otros: number
  vinculados: number; sinVincular: number
}
interface Props {
  dtes: DTE[]
  ventas: VentaSimple[]
  kpis: Kpis
  resumenMes: ResumenMes[]
  resumenTipo: ResumenTipo[]
  mesActual: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tipoBadge(tipo: string) {
  const colors: Record<string, { bg: string; txt: string }> = {
    '01': { bg: 'rgba(8,145,178,.15)',   txt: 'var(--teal)'  },
    '03': { bg: 'rgba(109,40,217,.15)',  txt: '#7c3aed'      },
    '05': { bg: 'rgba(220,38,38,.12)',   txt: 'var(--red)'   },
    '06': { bg: 'rgba(217,119,6,.15)',   txt: 'var(--amber)' },
  }
  const c = colors[tipo] ?? { bg: 'rgba(107,114,128,.12)', txt: 'var(--txt3)' }
  return (
    <span style={{ background: c.bg, color: c.txt, border: `1px solid ${c.txt}33`,
      padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {TIPO_DTE_LABEL[tipo] ?? `Tipo ${tipo}`}
    </span>
  )
}

function estadoBadge(estado: string) {
  const map: Record<string, { color: string; label: string }> = {
    PROCESADO:    { color: '#16a34a', label: 'Procesado' },
    RECHAZADO:    { color: '#dc2626', label: 'Rechazado' },
    CONTINGENCIA: { color: '#d97706', label: 'Contingencia' },
    ANULADO:      { color: '#6b7280', label: 'Anulado' },
    IMPORTADO:    { color: '#0891b2', label: 'Importado' },
  }
  const e = map[estado] ?? { color: '#6b7280', label: estado }
  return (
    <span style={{ background: e.color + '22', color: e.color, border: `1px solid ${e.color}44`,
      padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
      {e.label}
    </span>
  )
}

// ─── Modal detalle DTE ────────────────────────────────────────────────────────
function DetalleDteModal({ dte, ventas: ventasPropIgnorado, onClose, onVinculado }: {
  dte: DTE; ventas: VentaSimple[]; onClose: () => void; onVinculado: () => void
}) {
  const [ventaId, setVentaId] = useState(dte.venta_id ?? '')
  const [notas,   setNotas]   = useState(dte.notas ?? '')
  const [saving,  setSaving]  = useState(false)
  const [showJson,setShowJson]= useState(false)
  const [msg,     setMsg]     = useState('')

  // El modal siempre carga las ventas de SU PROPIO mes desde el servidor —
  // nunca depende de la lista global limitada (que puede excluir meses antiguos
  // si hay más de 300 ventas totales en el sistema, ordenadas por fecha reciente).
  const [ventasMes, setVentasMes] = useState<VentaSimple[] | null>(null)
  useEffect(() => {
    const mesDte = dte.fecha_emision.slice(0, 7)
    fetch(`/api/dte?mes=${mesDte}`)
      .then(r => r.json())
      .then(d => setVentasMes(d.ok ? d.ventas : []))
      .catch(() => setVentasMes([]))
  }, [dte.fecha_emision])

  const ventas = ventasMes ?? ventasPropIgnorado ?? []
  const cargandoVentas = ventasMes === null

  async function vincular() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/dte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vincular_venta', dte_id: dte.id, venta_id: ventaId || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setMsg('✅ Vínculo guardado')
      onVinculado()
    } catch (e: unknown) {
      setMsg('❌ ' + (e instanceof Error ? e.message : 'Error'))
    } finally { setSaving(false) }
  }

  async function guardarNotas() {
    setSaving(true); setMsg('')
    try {
      const res = await fetch('/api/dte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_notas', dte_id: dte.id, notas }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setMsg('✅ Notas guardadas')
    } catch (e: unknown) {
      setMsg('❌ ' + (e instanceof Error ? e.message : 'Error'))
    } finally { setSaving(false) }
  }

  const json = dte.json_original as Record<string, unknown>

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ maxWidth: 680 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>🧾 Detalle DTE</h3>
            <div style={{ fontSize: 11, color: 'var(--txt3)', fontFamily: 'monospace' }}>{dte.numero_control}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {tipoBadge(dte.tipo_dte)}
          {estadoBadge(dte.estado)}
          {dte.ambiente === '00' && (
            <span style={{ background: 'rgba(217,119,6,.15)', color: 'var(--amber)', border: '1px solid rgba(217,119,6,.3)',
              padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>PRUEBAS</span>
          )}
          {dte.sello_recepcion && (
            <span style={{ background: 'rgba(22,163,74,.12)', color: '#16a34a', border: '1px solid rgba(22,163,74,.3)',
              padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>✓ Sellado MH</span>
          )}
        </div>

        {/* Grid de datos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>Receptor</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{dte.receptor_nombre || '—'}</div>
            {dte.receptor_nit && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>NIT: {dte.receptor_nit}</div>}
            {dte.receptor_nrc && <div style={{ fontSize: 11, color: 'var(--txt3)' }}>NRC: {dte.receptor_nrc}</div>}
          </div>
          <div style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>Emisor</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{dte.emisor_nombre || '—'}</div>
            {dte.emisor_nit && <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>NIT: {dte.emisor_nit}</div>}
            {dte.emisor_nrc && <div style={{ fontSize: 11, color: 'var(--txt3)' }}>NRC: {dte.emisor_nrc}</div>}
          </div>
        </div>

        {/* Montos */}
        <div style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 10 }}>Montos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {[
              { label: 'No Sujeto',  val: dte.total_no_sujeto },
              { label: 'Exento',     val: dte.total_exento },
              { label: 'Gravado',    val: dte.total_gravado },
              { label: 'Sub Total',  val: dte.sub_total },
              { label: 'IVA Reten.', val: dte.iva_retenido },
              { label: 'TOTAL',      val: dte.total_pagar, highlight: true },
            ].map(({ label, val, highlight }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--txt3)' }}>{label}</div>
                <div style={{ fontSize: highlight ? 16 : 13, fontWeight: highlight ? 800 : 600,
                  color: highlight ? 'var(--teal)' : 'var(--txt)', fontFamily: 'monospace' }}>
                  {fmtUSD(val ?? 0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Fecha y archivo */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, fontSize: 12 }}>
          <div>
            <span style={{ color: 'var(--txt3)' }}>Fecha emisión: </span>
            <strong>{dte.fecha_emision}{dte.hora_emision ? ' ' + dte.hora_emision : ''}</strong>
          </div>
          {dte.archivo_origen && (
            <div>
              <span style={{ color: 'var(--txt3)' }}>Archivo: </span>
              <strong style={{ fontFamily: 'monospace', fontSize: 11 }}>{dte.archivo_origen}</strong>
            </div>
          )}
          {dte.sello_recepcion && (
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ color: 'var(--txt3)' }}>Sello MH: </span>
              <strong style={{ fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>{dte.sello_recepcion}</strong>
            </div>
          )}
        </div>

        {/* Vincular a venta */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 8 }}>
            🔗 Vincular a venta ERP
          </div>

          {/* Ventas del mismo mes ordenadas por proximidad de monto */}
          {(() => {
            const mesDte = dte.fecha_emision.slice(0, 7)
            if (cargandoVentas) {
              return (
                <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--txt3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="spinner" style={{ width: 12, height: 12 }} />
                  Cargando ventas de {mesDte}...
                </div>
              )
            }
            const ventasMes = ventas.filter(v => v.fecha.startsWith(mesDte))
            return (
              <div style={{ marginBottom: 8, fontSize: 11, color: 'var(--txt3)' }}>
                {ventasMes.length > 0
                  ? <span>📅 <strong>{ventasMes.length} ventas</strong> del mismo mes ({mesDte}) — ordenadas por proximidad de monto</span>
                  : <span style={{ color: 'var(--amber)' }}>⚠️ No hay ventas registradas en {mesDte}</span>
                }
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: 8 }}>
            <select value={ventaId} onChange={e => setVentaId(e.target.value)}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
              <option value="">— Sin vincular —</option>
              {/* Ventas del mismo mes primero, ordenadas por cercanía de monto */}
              {ventas
                .filter(v => v.fecha.startsWith(dte.fecha_emision.slice(0, 7)))
                .sort((a, b) => Math.abs(a.monto - (dte.total_pagar ?? 0)) - Math.abs(b.monto - (dte.total_pagar ?? 0)))
                .map(v => {
                  const diff = Math.abs(v.monto - (dte.total_pagar ?? 0))
                  const match = diff < 0.01 ? '✅ EXACTO' : diff < v.monto * 0.05 ? '🟡 Cercano' : '🔸'
                  return (
                    <option key={v.id} value={v.id}>
                      {match} {v.numero ?? v.id.slice(0,8)} | {v.fecha} | {v.nombre} | {fmtUSD(v.monto)}
                    </option>
                  )
                })
              }
              {/* Otros meses separados */}
              {ventas.some(v => !v.fecha.startsWith(dte.fecha_emision.slice(0, 7))) && (
                <option disabled>── Otros meses ──</option>
              )}
              {ventas
                .filter(v => !v.fecha.startsWith(dte.fecha_emision.slice(0, 7)))
                .map(v => (
                  <option key={v.id} value={v.id}>
                    {v.numero ?? v.id.slice(0,8)} | {v.fecha} | {v.nombre} | {fmtUSD(v.monto)}
                  </option>
                ))
              }
            </select>
            <button className="btn btn-primary btn-sm" onClick={vincular} disabled={saving}>
              {saving ? '⏳' : '💾 Vincular'}
            </button>
          </div>
          {dte.venta && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#16a34a' }}>
              ✓ Vinculado a {dte.venta.numero ?? '—'} — {dte.venta.nombre}
            </div>
          )}
        </div>

        {/* Notas */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', marginBottom: 6 }}>Notas</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12, resize: 'vertical' }}
              placeholder="Notas internas..." />
            <button className="btn btn-secondary btn-sm" onClick={guardarNotas} disabled={saving} style={{ alignSelf: 'flex-start' }}>
              💾
            </button>
          </div>
        </div>

        {msg && <div style={{ fontSize: 12, marginBottom: 10, color: msg.startsWith('✅') ? '#16a34a' : 'var(--red)' }}>{msg}</div>}

        {/* JSON crudo */}
        <div style={{ borderTop: '1px solid var(--bdr)', paddingTop: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowJson(!showJson)}>
            {showJson ? '🙈 Ocultar JSON' : '👁 Ver JSON original'}
          </button>
          {showJson && (
            <pre style={{ marginTop: 10, background: 'var(--surf2)', borderRadius: 'var(--r)',
              padding: 12, fontSize: 10, overflow: 'auto', maxHeight: 300,
              border: '1px solid var(--bdr)', color: 'var(--txt2)' }}>
              {JSON.stringify(json, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DROP ZONE ────────────────────────────────────────────────────────────────
interface ImportResult {
  exitosos: number; fallidos: number
  resultados: { nombre: string; ok: boolean; numero_control?: string; error?: string }[]
}

function ImportDropzone({ onImported }: { onImported: (res: ImportResult) => void }) {
  const [dragging, setDragging] = useState(false)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function processFiles(files: FileList | File[]) {
    setLoading(true); setResult(null)
    const docs: { json: Record<string, unknown>; nombre: string }[] = []
    const errores: string[] = []

    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.json')) { errores.push(`${file.name}: no es JSON`); continue }
      try {
        const text = await file.text()
        const json = JSON.parse(text)
        docs.push({ json, nombre: file.name })
      } catch {
        errores.push(`${file.name}: JSON inválido`)
      }
    }

    if (!docs.length && errores.length) {
      setResult({ exitosos: 0, fallidos: errores.length, resultados: errores.map(e => ({ nombre: e, ok: false, error: e })) })
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/dte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_dte', documentos: docs }),
      })
      const data: ImportResult = await res.json()
      setResult(data)
      onImported(data)
    } catch {
      setResult({ exitosos: 0, fallidos: docs.length, resultados: docs.map(d => ({ nombre: d.nombre, ok: false, error: 'Error de red' })) })
    } finally { setLoading(false) }
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? 'var(--teal)' : 'var(--bdr)'}`,
          borderRadius: 12, padding: '32px 20px', textAlign: 'center', cursor: 'pointer',
          background: dragging ? 'rgba(8,145,178,.06)' : 'var(--surf2)',
          transition: 'all .2s',
        }}>
        <input ref={inputRef} type="file" accept=".json" multiple style={{ display: 'none' }}
          onChange={e => e.target.files && processFiles(e.target.files)} />
        <div style={{ fontSize: 36, marginBottom: 8 }}>{loading ? '⏳' : '📂'}</div>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          {loading ? 'Importando...' : 'Arrastra archivos JSON aquí'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
          {loading ? 'Procesando y guardando en base de datos...' : 'O haz clic para seleccionar — puedes importar múltiples archivos a la vez'}
        </div>
      </div>

      {result && (
        <div style={{ marginTop: 14, borderRadius: 'var(--r)', border: '1px solid var(--bdr)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: result.fallidos === 0 ? 'rgba(22,163,74,.1)' : 'rgba(217,119,6,.1)',
            display: 'flex', gap: 16, fontSize: 13 }}>
            <span>✅ <strong>{result.exitosos}</strong> importados</span>
            {result.fallidos > 0 && <span>❌ <strong>{result.fallidos}</strong> con error</span>}
          </div>
          <div style={{ maxHeight: 180, overflow: 'auto' }}>
            {result.resultados.map((r, i) => (
              <div key={i} style={{ padding: '7px 14px', borderTop: i > 0 ? '1px solid var(--bdr)' : 'none',
                fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--txt2)' }}>{r.nombre}</span>
                {r.ok
                  ? <span style={{ color: '#16a34a', fontFamily: 'monospace', fontSize: 10 }}>✓ {r.numero_control}</span>
                  : <span style={{ color: 'var(--red)', fontSize: 10 }}>✗ {r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Módulo principal ─────────────────────────────────────────────────────────
export default function DteModule({ dtes: initialDtes, ventas, kpis: initialKpis, resumenMes, resumenTipo }: Props) {
  const [dtes,       setDtes]       = useState(initialDtes)
  const [kpis,       setKpis]       = useState(initialKpis)
  const [tab,        setTab]        = useState<'archivo' | 'reportes' | 'importar' | 'cierre'>('archivo')
  const [cierreMes,      setCierreMes]      = useState(new Date().toISOString().slice(0, 7))
  const [procesandoCruce, setProcesandoCruce] = useState(false)
  const [resultCruce,     setResultCruce]     = useState<{ vinculados: number; creadas: number; errores: string[] } | null>(null)
  const [cierreDtes,      setCierreDtes]      = useState<DTE[] | null>(null)
  const [cierreVentas,    setCierreVentas]    = useState<VentaSimple[] | null>(null)
  const [cargandoCierre,  setCargandoCierre]  = useState(false)

  // Cargar datos del mes directamente del servidor (evita el límite de 500 del listado general)
  useEffect(() => {
    setCargandoCierre(true)
    setCierreDtes(null); setCierreVentas(null)
    fetch(`/api/dte?mes=${cierreMes}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setCierreDtes(d.dtes); setCierreVentas(d.ventas) }
      })
      .finally(() => setCargandoCierre(false))
  }, [cierreMes])
  const [search,     setSearch]     = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [filterMes,  setFilterMes]  = useState('')
  const [detalle,    setDetalle]    = useState<DTE | null>(null)
  const [exportando, setExportando] = useState(false)

  // Filtros
  const meses = Array.from(new Set(dtes.map(d => d.fecha_emision.slice(0, 7)).filter(Boolean))).sort().reverse()
  const tipos  = Array.from(new Set(dtes.map(d => d.tipo_dte))).sort()

  const filtrados = dtes.filter(d => {
    if (filterTipo && d.tipo_dte !== filterTipo) return false
    if (filterMes  && !d.fecha_emision.startsWith(filterMes)) return false
    if (search) {
      const q = search.toLowerCase()
      return d.receptor_nombre.toLowerCase().includes(q)
          || d.numero_control.toLowerCase().includes(q)
          || d.codigo_generacion.toLowerCase().includes(q)
          || (d.receptor_nit ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const reload = useCallback(() => { window.location.reload() }, [])

  async function exportarCSV() {
    setExportando(true)
    try {
      const res = await fetch('/api/dte?export=csv')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `disabi-dte-${new Date().toISOString().slice(0,10)}.csv`
      a.click(); URL.revokeObjectURL(url)
    } finally { setExportando(false) }
  }

  async function eliminarDte(id: string) {
    if (!confirm('¿Eliminar este DTE del archivo?')) return
    await fetch('/api/dte', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_dte', id }) })
    setDtes(d => d.filter(x => x.id !== id))
    // Recalc kpis simple
    setKpis(k => ({ ...k, total: k.total - 1 }))
  }

  const TABS = [
    { key: 'archivo',  label: '🗂 Archivo DTE' },
    { key: 'reportes', label: '📊 Reportes' },
    { key: 'importar', label: '📥 Importar' },
    { key: 'cierre',   label: '📋 Cierre Mensual' },
  ] as const

  return (
    <div className="page-content">
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total DTE',       value: String(kpis.total),              color: 'var(--teal)',  sub: fmtUSD(kpis.totalPagar) },
          { label: 'Este mes',        value: String(kpis.mesCantidad),        color: '#7c3aed',      sub: fmtUSD(kpis.mesPagar) },
          { label: 'FCF / CCF',       value: `${kpis.fcf} / ${kpis.ccf}`,    color: 'var(--teal)',  sub: `${kpis.nc} NC` },
          { label: 'Vinculados ERP',  value: String(kpis.vinculados),         color: '#16a34a',      sub: `${kpis.sinVincular} sin vincular` },
          { label: 'Otros tipos',     value: String(kpis.otros),              color: 'var(--txt3)',  sub: '' },
        ].map(k => (
          <div key={k.label} className="kpi-card" style={{ borderTop: `3px solid ${k.color}` }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color, fontSize: 20 }}>{k.value}</div>
            {k.sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="tab-bar" style={{ marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t.key} className={`tab-btn${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: ARCHIVO ── */}
      {tab === 'archivo' && (
        <div>
          {/* Filtros + acciones */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Buscar receptor, número control, NIT..."
              style={{ flex: 1, minWidth: 220, padding: '7px 12px', borderRadius: 'var(--r)',
                border: '1px solid var(--bdr)', background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}
            />
            <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
              <option value="">Todos los tipos</option>
              {tipos.map(t => <option key={t} value={t}>{TIPO_DTE_LABEL[t] ?? t}</option>)}
            </select>
            <select value={filterMes} onChange={e => setFilterMes(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--bdr)',
                background: 'var(--surf)', color: 'var(--txt)', fontSize: 12 }}>
              <option value="">Todos los meses</option>
              {meses.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="btn btn-secondary btn-sm" onClick={exportarCSV} disabled={exportando}>
              {exportando ? '⏳' : '⬇ CSV'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setTab('importar')}>
              + Importar
            </button>
          </div>

          {/* Contador */}
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
            {filtrados.length} de {dtes.length} documentos
            {(filterTipo || filterMes || search) && (
              <button onClick={() => { setSearch(''); setFilterTipo(''); setFilterMes('') }}
                style={{ marginLeft: 8, fontSize: 10, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer' }}>
                ✕ Limpiar filtros
              </button>
            )}
          </div>

          {/* Tabla */}
          {filtrados.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 48, color: 'var(--txt3)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧾</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {dtes.length === 0 ? 'No hay DTE importados' : 'Sin resultados'}
              </div>
              <div style={{ fontSize: 12 }}>
                {dtes.length === 0
                  ? <button className="btn btn-primary btn-sm" onClick={() => setTab('importar')} style={{ marginTop: 10 }}>📥 Importar primer DTE</button>
                  : 'Prueba con otros filtros'}
              </div>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>Tipo</th>
                  <th>Número Control</th>
                  <th>Receptor</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Estado</th>
                  <th>Venta ERP</th>
                  <th>Acción</th>
                </tr></thead>
                <tbody>
                  {filtrados.slice(0, 100).map(d => (
                    <tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setDetalle(d)}>
                      <td>{tipoBadge(d.tipo_dte)}</td>
                      <td className="mono" style={{ fontSize: 10, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.numero_control}
                      </td>
                      <td style={{ fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.receptor_nombre || '—'}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{d.fecha_emision}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--teal)' }}>
                        {fmtUSD(d.total_pagar)}
                      </td>
                      <td>{estadoBadge(d.estado)}</td>
                      <td style={{ fontSize: 11 }}>
                        {d.venta
                          ? <span style={{ color: '#16a34a' }}>✓ {(d.venta as { numero?: string }).numero ?? '—'}</span>
                          : <span style={{ color: 'var(--txt3)', fontSize: 10 }}>Sin vincular</span>}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(d)}>👁</button>
                          <button className="btn btn-danger btn-sm" onClick={() => eliminarDte(d.id)}>🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtrados.length > 100 && (
                <div style={{ padding: 12, fontSize: 12, color: 'var(--txt3)', textAlign: 'center' }}>
                  Mostrando 100 de {filtrados.length}. Usa los filtros para acotar.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: REPORTES ── */}
      {tab === 'reportes' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Resumen por mes */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>📅 Resumen por Mes</div>
            {resumenMes.length === 0 ? (
              <div style={{ color: 'var(--txt3)', fontSize: 12 }}>Sin datos</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Mes</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Docs</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Total</th>
                </tr></thead>
                <tbody>
                  {resumenMes.map(r => (
                    <tr key={r.mes} style={{ borderTop: '1px solid var(--bdr)' }}>
                      <td style={{ padding: '7px 0', fontFamily: 'monospace' }}>{r.mes}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--txt2)' }}>{r.cantidad}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontFamily: 'monospace' }}>
                        {fmtUSD(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Resumen por tipo */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>🏷 Resumen por Tipo</div>
            {resumenTipo.length === 0 ? (
              <div style={{ color: 'var(--txt3)', fontSize: 12 }}>Sin datos</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12 }}>
                <thead><tr>
                  <th style={{ textAlign: 'left', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Tipo</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Docs</th>
                  <th style={{ textAlign: 'right', paddingBottom: 8, color: 'var(--txt3)', fontWeight: 600 }}>Total</th>
                </tr></thead>
                <tbody>
                  {resumenTipo.map(r => (
                    <tr key={r.tipo} style={{ borderTop: '1px solid var(--bdr)' }}>
                      <td style={{ padding: '7px 0' }}>{tipoBadge(r.tipo)}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', color: 'var(--txt2)' }}>{r.cantidad}</td>
                      <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 700, color: 'var(--teal)', fontFamily: 'monospace' }}>
                        {fmtUSD(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--bdr)' }}>
                    <td style={{ padding: '8px 0', fontWeight: 700 }}>TOTAL</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 700 }}>
                      {resumenTipo.reduce((a, r) => a + r.cantidad, 0)}
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 800, color: 'var(--teal)', fontFamily: 'monospace' }}>
                      {fmtUSD(resumenTipo.reduce((a, r) => a + r.total, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Vinculación */}
          <div className="card" style={{ gridColumn: 'span 2' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>🔗 Estado de Vinculación con Ventas ERP</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { label: 'Vinculados',    value: kpis.vinculados,   color: '#16a34a', pct: kpis.total ? Math.round(kpis.vinculados / kpis.total * 100) : 0 },
                { label: 'Sin vincular',  value: kpis.sinVincular,  color: 'var(--amber)', pct: kpis.total ? Math.round(kpis.sinVincular / kpis.total * 100) : 0 },
                { label: 'Total archivo', value: kpis.total,        color: 'var(--teal)', pct: 100 },
              ].map(k => (
                <div key={k.label} style={{ textAlign: 'center', padding: 16, background: 'var(--surf2)', borderRadius: 'var(--r)' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: k.color, fontFamily: 'monospace' }}>{k.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 2 }}>{k.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{k.pct}%</div>
                </div>
              ))}
            </div>
            {kpis.sinVincular > 0 && (
              <div style={{ marginTop: 14, padding: 10, background: 'rgba(217,119,6,.08)', borderRadius: 'var(--r)',
                fontSize: 12, color: 'var(--amber)', border: '1px solid rgba(217,119,6,.25)' }}>
                ⚠️ Tienes {kpis.sinVincular} DTE sin vincular a ventas ERP.
                Ve al tab <strong>Archivo DTE</strong>, abre cada documento y usa <strong>Vincular a venta ERP</strong>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: IMPORTAR ── */}
      {tab === 'importar' && (
        <div style={{ maxWidth: 680, margin: '0 auto' }}>

          {/* ── Importación masiva ZIP ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>🗜️ Importación masiva desde ZIP</div>
              <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(8,145,178,.15)',
                color: 'var(--teal)', padding: '2px 7px', borderRadius: 20 }}>RECOMENDADO</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 18 }}>
              Comprime todas tus carpetas mensuales en un solo ZIP y súbelo aquí.
              El sistema procesará cada archivo JSON automáticamente, sin importar la estructura de subcarpetas.
              Los documentos duplicados se actualizan sin crear registros repetidos.
            </div>
            <ImportMasivaZip onDone={() => { reload(); setTab('archivo') }} />
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--bdr)' }} />
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>o importa archivos individuales</span>
            <div style={{ flex: 1, height: 1, background: 'var(--bdr)' }} />
          </div>

          {/* ── Importación JSON individual ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>📄 Importar JSON individuales</div>
            <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 16 }}>
              Arrastra uno o varios archivos .json directamente. Útil para agregar documentos nuevos.
            </div>
            <ImportDropzone onImported={reload} />
          </div>

          {/* Guía de formato */}
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>📋 Formato esperado del JSON</div>
            <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7 }}>
              <p style={{ marginBottom: 8 }}>El sistema lee la estructura estándar del MH El Salvador (Normativa DTE v2):</p>
              <pre style={{ background: 'var(--surf2)', borderRadius: 'var(--r)', padding: 12, fontSize: 10,
                overflow: 'auto', border: '1px solid var(--bdr)', color: 'var(--txt2)', marginBottom: 12 }}>
{`{
  "identificacion": {
    "tipoDte": "01",
    "numeroControl": "DTE-01-M001P001-...",
    "codigoGeneracion": "UUID",
    "fecEmi": "2025-01-15",
    "horEmi": "10:30:00",
    "ambiente": "01"
  },
  "emisor": { "nit": "...", "nombre": "..." },
  "receptor": { "nombre": "...", "nit": "..." },
  "resumen": {
    "totalGravada": 100.00,
    "totalPagar": 113.00
  },
  "respuestaMH": {
    "selloRecibido": "..."
  }
}`}
              </pre>
              <p style={{ fontSize: 11, color: 'var(--txt3)' }}>
                Compatible con variaciones de campo (<code>numControl</code>, <code>totalGravado</code>, etc.)
                de distintos sistemas del mercado salvadoreño.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB CIERRE MENSUAL ── */}
      {tab === 'cierre' && (() => {
        if (cargandoCierre || cierreDtes === null) {
          return (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--txt3)' }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              Cargando datos de {cierreMes}...
            </div>
          )
        }

        const dtesMes      = cierreDtes
        const ventasMes    = cierreVentas ?? []
        const sinVincular  = dtesMes.filter(d => !d.venta_id && d.tipo_dte !== '05' && d.tipo_dte !== '06')

        const [mesN, anioN] = [cierreMes.slice(5,7), cierreMes.slice(0,4)]
        const mesLabel = new Date(parseInt(anioN), parseInt(mesN)-1, 1)
          .toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })

        // Clasificación: seguro (1 DTE, 1 venta con mismo monto) / sin venta / manual
        const seguros: { dte: typeof sinVincular[0]; venta: VentaSimple }[] = []
        const sinVenta: typeof sinVincular = []
        const manuales: typeof sinVincular = []
        const ventasUsadas = new Set<string>()

        for (const dte of sinVincular) {
          const monto = dte.total_pagar ?? 0
          const candidatas = ventasMes.filter(v => Math.abs(v.monto - monto) <= 0.01 && !ventasUsadas.has(v.id))
          const dtesMismoMonto = sinVincular.filter(d => Math.abs((d.total_pagar ?? 0) - monto) <= 0.01)
          if (candidatas.length === 1 && dtesMismoMonto.length === 1) {
            seguros.push({ dte, venta: candidatas[0] }); ventasUsadas.add(candidatas[0].id)
          } else if (candidatas.length === 0) {
            sinVenta.push(dte)
          } else {
            manuales.push(dte)
          }
        }

        async function ejecutarCruce() {
          setProcesandoCruce(true); setResultCruce(null)
          let vinculados = 0, creadas = 0
          const errores: string[] = []

          for (const { dte, venta } of seguros) {
            try {
              const res = await fetch('/api/dte', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'vincular_venta', dte_id: dte.id, venta_id: venta.id }),
              })
              if (!res.ok) throw new Error((await res.json()).error)
              vinculados++
            } catch (e: unknown) {
              errores.push(`Vincular ${dte.numero_control}: ${e instanceof Error ? e.message : 'Error'}`)
            }
          }
          for (const dte of sinVenta) {
            try {
              const res = await fetch('/api/dte', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'crear_venta_desde_dte', dte_id: dte.id }),
              })
              if (!res.ok) throw new Error((await res.json()).error)
              creadas++
            } catch (e: unknown) {
              errores.push(`Crear ${dte.numero_control}: ${e instanceof Error ? e.message : 'Error'}`)
            }
          }
          setResultCruce({ vinculados, creadas, errores })
          setProcesandoCruce(false)
          // Recargar datos del mes para reflejar los cambios
          if (vinculados + creadas > 0) {
            fetch(`/api/dte?mes=${cierreMes}`)
              .then(r => r.json())
              .then(d => { if (d.ok) { setCierreDtes(d.dtes); setCierreVentas(d.ventas) } })
          }
        }

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div className="field" style={{ flex: '0 0 160px' }}>
                <label>Período</label>
                <input type="month" value={cierreMes} onChange={e => setCierreMes(e.target.value)} />
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 18 }}>
                {dtesMes.length} documentos · {ventasMes.length} ventas ERP · {mesLabel}
              </div>
            </div>

            {sinVincular.length === 0 && dtesMes.length > 0 && (
              <div style={{ padding: '10px 14px', background: 'rgba(22,163,74,.08)',
                border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--r)', fontSize: 12, color: '#16a34a' }}>
                ✅ Todos los DTEs de {mesLabel} tienen venta vinculada
              </div>
            )}

            {sinVincular.length > 0 && (
              <div style={{ border: '1px solid var(--bdr)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px', background: 'rgba(79,70,229,.06)',
                  borderBottom: '1px solid var(--bdr)', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>🔗 Cruce DTE ↔ Ventas — {sinVincular.length} pendientes</div>
                    <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{mesLabel}</div>
                  </div>
                  <button className="btn btn-primary"
                    disabled={procesandoCruce || (seguros.length === 0 && sinVenta.length === 0)}
                    onClick={ejecutarCruce}>
                    {procesandoCruce ? '⏳ Procesando...' : `⚡ Ejecutar cruce automático (${seguros.length + sinVenta.length})`}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid var(--bdr)' }}>
                  {[
                    { icon: '✅', label: 'Vinculación automática segura', count: seguros.length, color: '#16a34a', bg: 'rgba(22,163,74,.06)' },
                    { icon: '✨', label: 'Sin venta → crear genérica', count: sinVenta.length, color: 'var(--indigo)', bg: 'rgba(79,70,229,.06)' },
                    { icon: '✋', label: 'Requieren selección manual', count: manuales.length, color: 'var(--amber)', bg: 'rgba(217,119,6,.06)' },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '14px 16px', background: s.bg, borderRight: '1px solid var(--bdr)' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: 'monospace' }}>{s.count}</div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginTop: 2 }}>{s.icon} {s.label}</div>
                    </div>
                  ))}
                </div>

                {manuales.length > 0 && (
                  <details>
                    <summary style={{ padding: '8px 16px', fontSize: 11, color: 'var(--amber)', cursor: 'pointer', borderBottom: '1px solid var(--bdr)' }}>
                      Ver {manuales.length} DTEs que requieren selección manual ▸
                    </summary>
                    <div style={{ maxHeight: 180, overflow: 'auto' }}>
                      {manuales.map(dte => (
                        <div key={dte.id} style={{ padding: '6px 16px', borderBottom: '1px solid var(--bdr)',
                          fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--txt3)' }}>{dte.numero_control}</span>
                          <span>{dte.receptor_nombre}</span>
                          <span style={{ fontWeight: 700 }}>{fmtUSD(dte.total_pagar ?? 0)}</span>
                          <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(dte)}>Seleccionar →</button>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {resultCruce && (
                  <div style={{ padding: '12px 16px', background: resultCruce.errores.length === 0 ? 'rgba(22,163,74,.08)' : 'rgba(217,119,6,.08)',
                    borderTop: '1px solid var(--bdr)', fontSize: 12 }}>
                    <div style={{ fontWeight: 700 }}>
                      ✅ {resultCruce.vinculados} vinculados · ✨ {resultCruce.creadas} ventas creadas
                      {resultCruce.errores.length > 0 && ` · ❌ ${resultCruce.errores.length} errores`}
                    </div>
                    {resultCruce.errores.map((e, i) => (
                      <div key={i} style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'monospace' }}>✗ {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Modal de detalle */}
      {detalle && (
        <DetalleDteModal
          dte={detalle}
          ventas={ventas}
          onClose={() => setDetalle(null)}
          onVinculado={() => {
            setDetalle(null)
            // Recargar datos del mes de Cierre para reflejar la vinculación manual
            if (cierreDtes !== null) {
              fetch(`/api/dte?mes=${cierreMes}`)
                .then(r => r.json())
                .then(d => { if (d.ok) { setCierreDtes(d.dtes); setCierreVentas(d.ventas) } })
            }
          }}
        />
      )}
    </div>
  )
}

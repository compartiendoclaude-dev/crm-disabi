'use client'
import { useState, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Progreso {
  procesados: number
  total: number
  exitosos: number
  fallidos: number
  pct: number
}

interface Resultado {
  total: number
  exitosos: number
  duplicados: number
  fallidos: number
  errores: { archivo: string; error: string }[]
}

type Estado = 'idle' | 'cargando' | 'procesando' | 'done' | 'error'

// ─── Barra de progreso ────────────────────────────────────────────────────────
function BarraProgreso({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12,
        marginBottom: 6, color: 'var(--txt2)' }}>
        <span>{label}</span>
        <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{pct}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--surf2)', borderRadius: 99,
        border: '1px solid var(--bdr)', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: 'linear-gradient(90deg, var(--teal), #06b6d4)',
          borderRadius: 99,
          transition: 'width .3s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function ImportMasivaZip({ onDone }: { onDone: () => void }) {
  const [estado,    setEstado]    = useState<Estado>('idle')
  const [progreso,  setProgreso]  = useState<Progreso | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [errorMsg,  setErrorMsg]  = useState('')
  const [dragging,  setDragging]  = useState(false)
  const [zipInfo,   setZipInfo]   = useState<{ nombre: string; size: string } | null>(null)
  const [mostrarErr,setMostrarErr]= useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const abortRef  = useRef<AbortController | null>(null)

  function fmtBytes(b: number) {
    if (b < 1024)       return b + ' B'
    if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB'
    return (b / 1048576).toFixed(1) + ' MB'
  }

  function resetear() {
    abortRef.current?.abort()
    setEstado('idle'); setProgreso(null); setResultado(null)
    setErrorMsg(''); setZipInfo(null); setMostrarErr(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function procesarZip(file: File) {
    // Validar
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setErrorMsg('El archivo debe ser un .zip')
      setEstado('error')
      return
    }
    if (file.size > 200 * 1024 * 1024) { // 200 MB límite
      setErrorMsg('El ZIP supera el límite de 200 MB')
      setEstado('error')
      return
    }

    setZipInfo({ nombre: file.name, size: fmtBytes(file.size) })
    setEstado('cargando')
    setErrorMsg('')
    setResultado(null)

    // Construir FormData
    const form = new FormData()
    form.append('zip', file)

    // Abort controller para cancelar
    abortRef.current = new AbortController()

    try {
      setEstado('procesando')
      const res = await fetch('/api/dte/bulk', {
        method: 'POST',
        body: form,
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error del servidor')
      }

      // Leer SSE
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'progress') {
              setProgreso({
                procesados: event.procesados,
                total:      event.total,
                exitosos:   event.exitosos,
                fallidos:   event.fallidos,
                pct:        event.pct,
              })
            }

            if (event.type === 'done') {
              setResultado({
                total:     event.total,
                exitosos:  event.exitosos,
                duplicados: event.duplicados ?? 0,
                fallidos:  event.fallidos,
                errores:   event.errores ?? [],
              })
              setEstado('done')
              if (event.exitosos > 0) {
                // Dar un momento para que el usuario vea el resultado antes de recargar
                setTimeout(onDone, 1500)
              }
            }
          } catch { /* ignorar líneas malformadas */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') {
        setEstado('idle')
        setZipInfo(null)
      } else {
        setErrorMsg(e instanceof Error ? e.message : 'Error de conexión')
        setEstado('error')
      }
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Drop zone — solo visible en idle/error */}
      {(estado === 'idle' || estado === 'error') && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) procesarZip(f) }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? 'var(--teal)' : estado === 'error' ? 'var(--red)' : 'var(--bdr)'}`,
            borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
            background: dragging ? 'rgba(8,145,178,.06)' : 'var(--surf2)',
            transition: 'all .2s',
          }}>
          <input ref={inputRef} type="file" accept=".zip" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) procesarZip(f) }} />
          <div style={{ fontSize: 44, marginBottom: 10 }}>🗜️</div>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
            Arrastra tu ZIP aquí
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt3)', marginBottom: 4 }}>
            O haz clic para seleccionar — el ZIP puede contener subcarpetas por mes
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Máximo 200 MB · Todos los .json dentro del ZIP se procesarán automáticamente
          </div>
          {estado === 'error' && errorMsg && (
            <div style={{ marginTop: 14, padding: '8px 14px', background: 'rgba(220,38,38,.1)',
              border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, fontSize: 12, color: 'var(--red)' }}>
              ❌ {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* Progreso — visible durante procesamiento */}
      {(estado === 'cargando' || estado === 'procesando') && (
        <div style={{ background: 'var(--surf2)', borderRadius: 12, padding: 24,
          border: '1px solid var(--bdr)' }}>

          {/* Info del archivo */}
          {zipInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
              padding: 12, background: 'var(--surf)', borderRadius: 8, border: '1px solid var(--bdr)' }}>
              <div style={{ fontSize: 24 }}>🗜️</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{zipInfo.nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{zipInfo.size}</div>
              </div>
              <button
                onClick={resetear}
                style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--bdr)',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                  color: 'var(--txt3)' }}>
                ✕ Cancelar
              </button>
            </div>
          )}

          {estado === 'cargando' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Descomprimiendo ZIP...</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)' }}>Leyendo estructura de carpetas</div>
            </div>
          )}

          {estado === 'procesando' && progreso && (
            <>
              <div style={{ marginBottom: 20 }}>
                <BarraProgreso
                  pct={progreso.pct}
                  label={`Procesando ${progreso.procesados.toLocaleString()} de ${progreso.total.toLocaleString()} documentos`}
                />
              </div>

              {/* Contadores en tiempo real */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { label: 'Importados',  value: progreso.exitosos, color: '#16a34a', icon: '✅' },
                  { label: 'Pendientes',  value: progreso.total - progreso.procesados, color: 'var(--teal)', icon: '⏳' },
                  { label: 'Con error',   value: progreso.fallidos, color: progreso.fallidos > 0 ? 'var(--red)' : 'var(--txt3)', icon: '❌' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign: 'center', padding: '12px 8px',
                    background: 'var(--surf)', borderRadius: 8, border: '1px solid var(--bdr)' }}>
                    <div style={{ fontSize: 9, color: 'var(--txt3)', textTransform: 'uppercase',
                      letterSpacing: '.5px', marginBottom: 4 }}>{k.icon} {k.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: k.color, fontFamily: 'monospace' }}>
                      {k.value.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--txt3)', textAlign: 'center' }}>
                Procesando en lotes de 50 · No cierres esta ventana
              </div>
            </>
          )}
        </div>
      )}

      {/* Resultado final */}
      {estado === 'done' && resultado && (
        <div style={{ borderRadius: 12, border: '1px solid var(--bdr)', overflow: 'hidden' }}>
          {/* Header resultado */}
          <div style={{
            padding: '16px 20px',
            background: resultado.fallidos === 0
              ? 'rgba(22,163,74,.1)'
              : resultado.exitosos > 0
                ? 'rgba(217,119,6,.1)'
                : 'rgba(220,38,38,.1)',
            borderBottom: '1px solid var(--bdr)',
          }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>
              {resultado.fallidos === 0 ? '✅ Importación completada' :
               resultado.exitosos > 0  ? '⚠️ Importación con advertencias' : '❌ Importación fallida'}
            </div>
            <div style={{ display: 'flex', gap: 20, fontSize: 13 }}>
              <span>📄 <strong>{resultado.total.toLocaleString()}</strong> archivos en el ZIP</span>
              <span style={{ color: '#16a34a' }}>✅ <strong>{resultado.exitosos.toLocaleString()}</strong> importados</span>
              {resultado.fallidos > 0 && (
                <span style={{ color: 'var(--red)' }}>❌ <strong>{resultado.fallidos}</strong> con error</span>
              )}
            </div>
          </div>

          {/* Barra final 100% */}
          <div style={{ padding: '14px 20px', borderBottom: resultado.errores.length ? '1px solid var(--bdr)' : 'none' }}>
            <BarraProgreso pct={100} label="Procesamiento completado" />
          </div>

          {/* Lista de errores */}
          {resultado.errores.length > 0 && (
            <div>
              <button
                onClick={() => setMostrarErr(!mostrarErr)}
                style={{ width: '100%', padding: '10px 20px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', fontSize: 12, color: 'var(--txt2)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>⚠️ Ver {resultado.errores.length} error{resultado.errores.length !== 1 ? 'es' : ''}</span>
                <span>{mostrarErr ? '▲' : '▼'}</span>
              </button>
              {mostrarErr && (
                <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--bdr)' }}>
                  {resultado.errores.map((e, i) => (
                    <div key={i} style={{ padding: '7px 20px', borderTop: i > 0 ? '1px solid var(--bdr)' : 'none',
                      fontSize: 11, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <span style={{ color: 'var(--red)', flexShrink: 0 }}>✗</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--txt3)', wordBreak: 'break-all', flex: 1 }}>
                        {e.archivo}
                      </span>
                      <span style={{ color: 'var(--txt3)', flexShrink: 0 }}>{e.error}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Acciones post-importación */}
          <div style={{ padding: '14px 20px', background: 'var(--surf2)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={resetear}>
              📥 Importar otro ZIP
            </button>
            <button className="btn btn-primary btn-sm" onClick={onDone}>
              🗂 Ver archivo DTE
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

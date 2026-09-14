'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Props {
  mesActual: string   // YYYY-MM que se está mostrando
  esMesActual: boolean
}

export default function MesSelector({ mesActual, esMesActual }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function irAMes(mes: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (mes) params.set('mes', mes)
    else params.delete('mes')
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="res-mes-selector">
      <span className="res-mes-selector__label">📅 Viendo</span>
      <input
        type="month"
        className="res-mes-selector__input"
        value={mesActual}
        max={new Date().toISOString().slice(0, 7)}
        onChange={e => e.target.value && irAMes(e.target.value)}
        aria-label="Seleccionar mes del Resumen"
      />
      {!esMesActual && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => irAMes('')}>
          ↺ Volver al mes actual
        </button>
      )}
      {!esMesActual && (
        <span className="res-mes-selector__note">
          Hoy, esta semana y las alertas siguen mostrando la fecha real — solo las secciones marcadas &quot;del mes&quot; cambian con este selector.
        </span>
      )}
    </div>
  )
}

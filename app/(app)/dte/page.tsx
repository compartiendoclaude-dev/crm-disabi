import Topbar from '@/components/layout/Topbar'
import DteModule from '@/components/dte/DteModule'
import { getDtePageData } from '@/lib/dte-data'

export const dynamic = 'force-dynamic'

export default async function DtePage() {
  const d = await getDtePageData()
  return (
    <>
      <Topbar titulo="🧾 DTE — Documentos Tributarios Electrónicos" />
      <DteModule
        dtes={d.dtes as never}
        ventas={d.ventas as never}
        kpis={d.kpis}
        resumenMes={d.resumenMes}
        resumenTipo={d.resumenTipo}
        mesActual={d.mesActual}
      />
    </>
  )
}

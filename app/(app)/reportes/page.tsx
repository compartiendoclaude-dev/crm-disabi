import Topbar from '@/components/layout/Topbar'
import ReportesModule from '@/components/reportes/ReportesModule'
import { getReportesData } from '@/lib/fase6-data'
export const dynamic = 'force-dynamic'
export default async function ReportesPage() {
  const d = await getReportesData()
  return (
    <>
      <Topbar titulo="📈 Reportes" />
      <ReportesModule
        ventas={d.ventas as never} gastos={d.gastos as never}
        costosFijos={d.costosFijos as never} cxc={d.cxc as never}
        cpp={d.cpp as never} productos={d.productos as never}
        clientes={d.clientes as never} ppPendientes={d.ppPendientes as never}
        finMes={d.finMes as never}
        hoy={d.hoy} mesActual={d.mesActual} mesInicio={d.mesInicio} mesFin={d.mesFin}
      />
    </>
  )
}

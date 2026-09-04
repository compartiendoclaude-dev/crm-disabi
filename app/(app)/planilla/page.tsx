import Topbar from '@/components/layout/Topbar'
import PlanillaModule from '@/components/planilla/PlanillaModule'
import { getPlanillaData } from '@/lib/fase6-data'
export const dynamic = 'force-dynamic'
export default async function PlanillaPage() {
  const d = await getPlanillaData()
  return (
    <>
      <Topbar titulo="👨‍💼 Planilla" />
      <div style={{ padding: 20 }}>
        <PlanillaModule
          empleados={d.empleados as never}
          planillaMes={d.planillaMes as never}
          planillaHistorico={d.planillaHistorico}
          comisiones={d.comisiones as never}
          kpis={d.kpis}
          mesActual={d.mesActual}
        />
      </div>
    </>
  )
}

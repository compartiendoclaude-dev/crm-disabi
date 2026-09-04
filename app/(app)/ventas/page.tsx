import Topbar from '@/components/layout/Topbar'
import VentasModule from '@/components/ventas/VentasModule'
import { getVentasPageData } from '@/lib/ventas-data'

export const dynamic = 'force-dynamic'

export default async function VentasPage() {
  const d = await getVentasPageData()
  return (
    <>
      <Topbar titulo="💰 Ventas" />
      <VentasModule
        ventas={d.ventas as never}
        cotizaciones={d.cotizaciones as never}
        pendientesPago={d.pendientesPago as never}
        productos={d.productos as never}
        clientes={d.clientes as never}
        devoluciones={d.devoluciones as never}
        ventasDevolvibles={d.ventasDevolvibles as never}
        devKpis={d.devKpis}
        kpis={d.kpis}
        cotKpis={d.cotKpis}
        ppKpis={d.ppKpis}
        mesActual={d.mesActual}
        empleados={d.empleados as never}
        hoy={d.hoy}
      />
    </>
  )
}

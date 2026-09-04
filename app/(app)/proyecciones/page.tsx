import Topbar from '@/components/layout/Topbar'
import ProyeccionesModule from '@/components/proyecciones/ProyeccionesModule'
import { getProyeccionesData } from '@/lib/fase6-data'
export const dynamic = 'force-dynamic'
export default async function ProyeccionesPage() {
  const d = await getProyeccionesData()
  return (
    <>
      <Topbar titulo="🔭 Proyecciones" />
      <ProyeccionesModule
        ventasPorMes={d.ventasPorMes} last6={d.last6}
        slope={d.slope} intercept={d.intercept}
        ingDiario={d.ingDiario} ingRef30={d.ingRef30}
        gastosMes30={d.gastosMes30} cfSum={d.cfSum} gastosOpMes={d.gastosOpMes}
        clientesNuevos30={d.clientesNuevos30}
        cxcProxMes={d.cxcProxMes} cppProxMes={d.cppProxMes}
        proyVentas={d.proyVentas} hoy={d.hoy}
      />
    </>
  )
}

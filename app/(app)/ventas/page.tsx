import Topbar from '@/components/layout/Topbar'
import VentasModule from '@/components/ventas/VentasModule'
import { getVentasPageData } from '@/lib/ventas-data'
import { requirePermisoPagina } from '@/lib/permisos-server'

export const dynamic = 'force-dynamic'

export default async function VentasPage() {
  // Hueco cerrado: esta página no validaba el rol — a diferencia de Finanzas y
  // Planilla, cualquier usuario autenticado podía entrar por la URL aunque su
  // rol no tuviera acceso al módulo Ventas (ej. un futuro rol sin permiso
  // alguno sobre 'ventas' seguía viendo la pantalla completa).
  await requirePermisoPagina('ventas')
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
        oportunidades={d.oportunidades as never}
        opKpis={d.opKpis}
      />
    </>
  )
}

import Topbar from '@/components/layout/Topbar'
import ComprasModule from '@/components/compras/ComprasModule'
import { getComprasData } from '@/lib/inventario-compras-data'
import { requirePermisoPagina } from '@/lib/permisos-server'

export const dynamic = 'force-dynamic'

export default async function ComprasPage() {
  // Hallazgo #7 (evaluación CPP): igual que Ventas, esta página no validaba el rol —
  // cualquier usuario autenticado podía entrar por la URL sin permiso sobre 'compras'.
  await requirePermisoPagina('compras')
  const d = await getComprasData()
  return (
    <>
      <Topbar titulo="🛒 Compras" />
      <ComprasModule
        compras={d.compras as never}
        gastosLocales={d.gastosLocales as never}
        productos={d.productos as never}
        kpis={d.kpis}
        proveedores={d.proveedores as never}
        proveedoresTextoLibre={d.proveedoresTextoLibre}
        comprasSinVincular={d.comprasSinVincular}
        proveedoresKpis={d.proveedoresKpis}
      />
    </>
  )
}

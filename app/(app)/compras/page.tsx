import Topbar from '@/components/layout/Topbar'
import ComprasModule from '@/components/compras/ComprasModule'
import { getComprasData } from '@/lib/inventario-compras-data'

export const dynamic = 'force-dynamic'

export default async function ComprasPage() {
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

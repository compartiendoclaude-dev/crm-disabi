import Topbar from '@/components/layout/Topbar'
import InventarioModule from '@/components/inventario/InventarioModule'
import { getInventarioData } from '@/lib/inventario-compras-data'

export const dynamic = 'force-dynamic'

export default async function InventarioPage() {
  const d = await getInventarioData()
  return (
    <>
      <Topbar titulo="📦 Inventario" />
      <InventarioModule
        productos={d.productos as never}
        movimientos={d.movimientos as never}
        kpis={d.kpis}
        lotes={d.lotes as never}
        lotesKpis={d.lotesKpis}
        hoy={d.hoy}
        en30s={d.en30s}
        en60s={d.en60s}
      />
    </>
  )
}

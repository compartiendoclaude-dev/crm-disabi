import Topbar from '@/components/layout/Topbar'
import ClientesModule from '@/components/clientes/ClientesModule'
import { getClientesData } from '@/lib/clientes-finanzas-data'

export const dynamic = 'force-dynamic'

export default async function ClientesPage() {
  const data = await getClientesData()
  return (
    <>
      <Topbar titulo="👥 Clientes" />
      <ClientesModule clientes={data.clientes as never} kpis={data.kpis} />
    </>
  )
}

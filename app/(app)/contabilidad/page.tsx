import Topbar from '@/components/layout/Topbar'
import ContabilidadModule from '@/components/contabilidad/ContabilidadModule'
import { requirePermisoPagina } from '@/lib/permisos-server'

export const dynamic = 'force-dynamic'

export default async function ContabilidadPage() {
  const { rol } = await requirePermisoPagina('contabilidad')
  return (
    <>
      <Topbar titulo="📒 Contabilidad" subtitulo="Libro Diario, Libro Mayor, Balance de Comprobación, Balance General y Estado de Resultados" />
      <ContabilidadModule rol={rol} />
    </>
  )
}

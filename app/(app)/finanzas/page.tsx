import Topbar from '@/components/layout/Topbar'
import FinanzasModule from '@/components/finanzas/FinanzasModule'
import { getFinanzasData } from '@/lib/clientes-finanzas-data'

export const dynamic = 'force-dynamic'

export default async function FinanzasPage() {
  const d = await getFinanzasData()
  return (
    <>
      <Topbar titulo="⚖️ Finanzas" />
      <FinanzasModule
        ingresosBrutos={d.ingresosBrutos}
        totalCostoCanal={d.totalCostoCanal}
        costoPaquetera={d.costoPaquetera}
        comisionPaquetera={d.comisionPaquetera}
        ivaPercibidoLiq={d.ivaPercibidoLiq}
        comisionLiqPOS={d.comisionLiqPOS}
        ingresoNeto={d.ingresoNeto}
        costoVentas={d.costoVentas}
        utilidadBruta={d.utilidadBruta}
        gastosOperativos={d.gastosOperativos}
        planillaDevengada={d.planillaDevengada}
        comisionesDevengadas={d.comisionesDevengadas}
        cfActivoSum={d.cfActivoSum}
        totalEgresosOp={d.totalEgresosOp}
        utilidadOperativa={d.utilidadOperativa}
        margenBruto={d.margenBruto}
        margenNeto={d.margenNeto}
        ingresosMes={d.ingresosMes}
        gastosMesSum={d.gastosMesSum}
        cxcAll={d.cxcAll as never}
        cxcAbonos={d.cxcAbonos}
        cxcKpis={d.cxcKpis}
        cppAll={d.cppAll as never}
        cppPagos={d.cppPagos}
        cppKpis={d.cppKpis}
        gastosMes={d.gastosMes as never}
        mayorGastoMonto={d.mayorGastoMonto}
        mayorGastoCat={d.mayorGastoCat}
        costosFijos={d.costosFijos as never}
        cobrosProx={d.cobrosProx}
        pagosProx={d.pagosProx}
        flujoNeto={d.flujoNeto}
        ppProximos={d.ppProximos}
        cppProximos={d.cppProximos}
        ventasPorMes={d.ventasPorMes as never}
        gastosPorMes={d.gastosPorMes}
        hoy={d.hoy}
        mesActual={d.mesActual}
      />
    </>
  )
}

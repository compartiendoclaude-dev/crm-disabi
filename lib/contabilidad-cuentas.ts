// ── Códigos del Plan de Cuentas (ver disabi_contabilidad_fase1.sql) ─────────
// Un solo lugar con los códigos que el código de la app realmente postea, para
// no repetir strings mágicos por todo el proyecto. Si el plan de cuentas
// cambia, se actualiza aquí y no en cada endpoint.
export const CUENTA = {
  CAJA:                         '110101',
  BANCOS:                       '110102',
  FONDOS_TRANSITO_PASARELA:     '110103',
  CXC_CLIENTES:                 '110201',
  ESTIMACION_INCOBRABLES:       '110202',
  INVENTARIO_DISPONIBLE:        '110301',
  MERCADERIA_TRANSITO:          '110302',
  IVA_CREDITO_FISCAL:           '1104',

  CXP_PROVEEDORES:              '2101',
  IVA_DEBITO_FISCAL:            '2102',
  IVA_POR_PAGAR:                '2103',
  RETENCIONES_CUOTAS_PATRONALES:'2104',
  PLANILLA_POR_PAGAR:           '2105',
  COMISIONES_POR_PAGAR:         '2106',
  CXP_GASTOS_OPERATIVOS:        '2107',

  UTILIDADES_RETENIDAS:         '3102',

  VENTAS:                       '4101',
  DEVOLUCIONES_VENTAS:          '4102',
  DESCUENTOS_VENTAS:            '4103',
  OTROS_INGRESOS:               '4104',

  COSTO_VENTAS_MERCADERIA:      '5101',
  COSTO_VENTAS_AJUSTES:         '5102',

  COMISIONES_SOBRE_VENTAS:      '6101',
  FLETES_PAQUETERIA:            '6102',
  COMISIONES_PASARELA:          '6103',
  SUELDOS_SALARIOS:             '6201',
  CUOTAS_PATRONALES:            '6202',
  ALQUILERES:                   '6203',
  COMPRAS_LOCALES_SUMINISTROS:  '6204',
  OTROS_GASTOS_OPERATIVOS:      '6205',

  PROPIEDAD_PLANTA_EQUIPO:      '1201',
  DEPRECIACION_ACUMULADA:       '1202',
} as const

// ── Gastos operativos (save_gasto de Finanzas) — el campo tipo_egreso ya
// clasifica el gasto para el Estado de Resultados (ver constants.ts); se
// reutiliza la misma clasificación para saber contra qué cuenta postear.
export const CUENTA_POR_TIPO_EGRESO: Record<string, string> = {
  operativo:       CUENTA.OTROS_GASTOS_OPERATIVOS,
  compra_local:    CUENTA.COMPRAS_LOCALES_SUMINISTROS,
  planilla:        CUENTA.SUELDOS_SALARIOS,
  comision_venta:  CUENTA.COMISIONES_SOBRE_VENTAS,
}

// ── CPP manual (save_cpp de Finanzas) — categoría elegida al crearla a mano,
// para no mandar todo a "Otros Gastos Operativos" por defecto.
export const CATEGORIA_CPP_CUENTA: Record<string, string> = {
  alquiler:   CUENTA.ALQUILERES,
  sueldos:    CUENTA.SUELDOS_SALARIOS,
  compras:    CUENTA.COMPRAS_LOCALES_SUMINISTROS,
  comisiones: CUENTA.COMISIONES_SOBRE_VENTAS,
  otro:       CUENTA.OTROS_GASTOS_OPERATIVOS,
}

// ── Costos Fijos (devengo mensual) — misma idea: categoría del costo fijo → cuenta.
export const CATEGORIA_COSTO_FIJO_CUENTA: Record<string, string> = {
  'Planilla':           CUENTA.SUELDOS_SALARIOS,
  'Alquiler':           CUENTA.ALQUILERES,
  'Servicios Básicos':  CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Internet':           CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Seguros':            CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Contabilidad':       CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Software':           CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Transporte':         CUENTA.OTROS_GASTOS_OPERATIVOS,
  'Otro':               CUENTA.OTROS_GASTOS_OPERATIVOS,
}

// ─── Roles ────────────────────────────────────────────────────────────────────
export type Rol = 'admin' | 'socio' | 'ventas' | 'finanzas'

export interface DiosabiUsuario {
  id: string
  user_id: string
  nombre: string
  email: string
  rol: Rol
  activo: boolean
  created_at: string
}

// ─── Clientes ─────────────────────────────────────────────────────────────────
export interface Cliente {
  id: string
  nombre: string
  contacto?: string
  email?: string
  telefono?: string
  sector?: string
  direccion?: string
  pais?: string
  limite_credito?: number
  notas?: string
  fecha_registro?: string
  created_at?: string
}

// ─── Productos / Inventario ───────────────────────────────────────────────────
export interface Producto {
  id: string
  codigo: string
  nombre: string
  categoria?: string
  unidad?: string
  precio_venta: number
  costo_unitario?: number
  precio_costo?: number  // alias legacy
  stock_actual: number
  stock_minimo?: number
  activo?: boolean
  created_at?: string
}

export interface MovimientoInv {
  id: string
  producto_id: string
  tipo: 'entrada' | 'salida' | 'ajuste' | 'muestra'
  cantidad: number
  costo_unitario?: number
  referencia?: string
  notas?: string
  fecha: string
  created_at?: string
  // join
  producto?: Producto
}

// ─── Ventas ───────────────────────────────────────────────────────────────────
export type MetodoPago = 'Efectivo' | 'Transferencia' | 'Credito' | 'Link de Pago' | 'Pago POS'
export type EstadoCobro = 'Cobrado' | 'Pendiente' | 'Borrador' | 'Parcial' | 'Liquidacion_Pendiente'

export interface Venta {
  id: string
  numero?: string
  nombre: string
  sector?: string
  plan?: string
  monto: number
  monto_neto?: number
  metodo_pago?: MetodoPago
  con_paquetera_efectivo?: boolean
  credito_50_50?: boolean
  paquetera?: string
  paquetera_costo?: number
  paquetera_comision?: number
  paquetera_com_monto?: number
  fecha_recoleccion?: string
  fecha_pago_paquetera?: string
  liq_iva_percibido?: number
  liq_comision?: number
  liq_iva_comision?: number
  liq_monto_liquido?: number
  fecha: string
  cobro: EstadoCobro
  canal?: string
  notas?: string
  vendedor_id?: string
  created_at?: string
  // joins
  items?: VentaItem[]
  vendedor?: { nombre: string; cargo?: string }
}

export interface VentaItem {
  id: string
  venta_id: string
  producto_id?: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct?: number
  subtotal: number
  orden?: number
  // join
  producto?: Producto
}

// ─── Cotizaciones / Pendientes de Pago ────────────────────────────────────────
export type TipoCotizacion = 'Cotizacion' | 'Orden de Venta' | 'Pendiente de Pago'
export type EstadoCotizacion = 'Borrador' | 'Enviada' | 'Aprobada' | 'Rechazada' | 'Pendiente' | 'Pagado' | 'Vencido'

export interface Cotizacion {
  id: string
  numero?: string
  tipo: TipoCotizacion
  cliente: string
  contacto?: string
  email?: string
  telefono?: string
  fecha_emision: string
  fecha_vence?: string
  fecha_entrega?: string
  subtotal: number
  descuento_pct?: number
  descuento_monto?: number
  impuesto_pct?: number
  impuesto_monto?: number
  envio_monto?: number
  direccion_envio?: string
  gran_contribuyente?: boolean
  retencion_monto?: number
  total: number
  estado: EstadoCotizacion
  sector?: string
  condiciones_pago?: string       // legacy string ("30 días") — mantener para compat
  metodo_pago?: MetodoPago
  dias_credito?: number
  credito_50_50?: boolean
  notas?: string
  notas_internas?: string
  monto_neto?: number
  paquetera?: string
  created_at?: string
  // join
  items?: CotizacionItem[]
}

export interface CotizacionItem {
  id: string
  cotizacion_id: string
  producto_id?: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  descuento_pct?: number
  subtotal: number
  orden?: number
  producto?: Producto
}

// ─── Compras ──────────────────────────────────────────────────────────────────
export type TipoCompra = 'local' | 'importacion'
export type EstadoCompra = 'Borrador' | 'Pedido' | 'En tránsito' | 'Recibido' | 'Cancelado'

export interface Compra {
  id: string
  numero?: string
  tipo: TipoCompra
  proveedor: string
  fecha: string
  fecha_esperada?: string
  fecha_recibido?: string
  subtotal: number
  flete?: number
  seguro?: number
  otros_costos?: number
  total: number
  estado: EstadoCompra
  cobro?: string
  notas?: string
  created_at?: string
  items?: CompraItem[]
}

export interface CompraItem {
  id: string
  compra_id: string
  producto_id?: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  producto?: Producto
}

// ─── Finanzas: CXC / CPP ──────────────────────────────────────────────────────
export type EstadoCXC = 'Pendiente' | 'Pagado' | 'Vencido' | 'Parcial'

export interface CXC {
  id: string
  numero?: string
  cliente: string
  fecha_emision: string
  fecha_vence?: string
  monto: number
  saldo: number
  estado: EstadoCXC
  referencia?: string
  notas?: string
  created_at?: string
  abonos?: CXCAbono[]
}

export interface CXCAbono {
  id: string
  cxc_id: string
  monto: number
  fecha: string
  notas?: string
}

export interface CPP {
  id: string
  numero?: string
  proveedor: string
  fecha_emision: string
  fecha_vence?: string
  monto: number
  saldo: number
  estado: EstadoCXC
  referencia?: string
  notas?: string
  created_at?: string
  pagos?: CPPPago[]
}

export interface CPPPago {
  id: string
  cpp_id: string
  monto: number
  fecha: string
  notas?: string
}

// ─── Gastos / Costos Fijos ────────────────────────────────────────────────────
export interface Gasto {
  id: string
  descripcion: string
  categoria?: string
  monto: number
  fecha: string
  notas?: string
}

export interface CostoFijo {
  id: string
  descripcion: string
  categoria?: string
  monto: number
  frecuencia?: string
  fecha_inicio?: string
  activo?: boolean
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
}

// ─── Planilla ─────────────────────────────────────────────────────────────────
export interface Empleado {
  id: string
  nombre: string
  cargo?: string
  departamento?: string
  salario_base: number
  fecha_ingreso?: string
  dui?: string
  nit?: string
  nup_isss?: string       // número único previsional ISSS
  nup_afp?: string        // número afiliación AFP
  afp?: string            // CRECER | CONFIA
  tipo_contrato?: 'empleado' | 'honorarios'  // empleado = planilla normal, honorarios = solo retención ISR 10%
  activo?: boolean
  created_at?: string
}

export type EstadoPlanilla = 'Pendiente' | 'Pagado' | 'Anulado'

export interface PlanillaRegistro {
  id: string
  empleado_id: string
  periodo: string           // YYYY-MM
  salario_bruto: number
  tipo_pago?: 'empleado' | 'honorarios'
  isss_empleado: number     // 3% (0 si es honorarios)
  afp_empleado: number      // 7.25% (0 si es honorarios)
  renta: number             // retención ISR
  otras_deducciones: number
  total_deducciones: number
  bonos: number
  salario_neto: number
  // aporte patronal (informativo, no descuenta del empleado)
  isss_patronal: number     // 7.5%
  afp_patronal: number      // 8.75%
  costo_total_empresa: number
  estado: EstadoPlanilla
  fecha_pago?: string
  notas?: string
  created_at?: string
  // join
  empleado?: Empleado
}

// ─── Comisiones ───────────────────────────────────────────────────────────────
export interface ComisionRango {
  id: string
  categoria: string
  precio_iva_desc: string
  precio_min_iva?: number
  precio_max_iva?: number
  precio_sin_iva: number
  pct_comision: number
  orden: number
  activo?: boolean
}

export interface ComisionLinea {
  id: string
  comision_registro_id: string
  rango_id?: string
  categoria: string
  precio_iva_desc: string
  precio_sin_iva: number
  pct_comision: number
  cantidad_vendida: number
  comision_linea: number
}

export type EstadoComision = 'Pendiente' | 'Pagado' | 'Bloqueado'

export interface ComisionRegistro {
  id: string
  empleado_id: string
  periodo: string
  fecha_pago_prog?: string
  comision_bruta: number
  retencion_isr: number
  comision_neta: number
  tipo_calculo: 'empleado' | 'honorarios'
  estado: EstadoComision
  fecha_pago_real?: string
  notas?: string
  created_at?: string
  // joins
  empleado?: { nombre: string; cargo?: string }
  lineas?: ComisionLinea[]
}

// ─── Proveedores ──────────────────────────────────────────────────────────────
export interface Proveedor {
  id: string
  nombre: string
  razon_social?: string
  nit?: string
  nrc?: string
  contacto?: string
  email?: string
  telefono?: string
  pais?: string
  direccion?: string
  tipo?: 'local' | 'importacion' | 'ambos'
  moneda?: string
  dias_credito?: number
  limite_credito?: number
  notas?: string
  activo?: boolean
  created_at?: string
}

// ─── Lotes ────────────────────────────────────────────────────────────────────
export interface Lote {
  id: string
  producto_id: string
  numero_lote: string
  fecha_vencimiento: string
  fecha_ingreso?: string
  cantidad_inicial: number
  cantidad_actual: number
  compra_id?: string
  notas?: string
  activo?: boolean
  created_at?: string
  // joins
  producto?: { nombre: string; codigo: string; unidad?: string }
}

// ─── Devoluciones ─────────────────────────────────────────────────────────────
export type TipoDevolucion  = 'total' | 'parcial'
export type EstadoDevolucion = 'Procesada' | 'Anulada'

export interface Devolucion {
  id: string
  numero?: string
  venta_id: string
  fecha: string
  tipo: TipoDevolucion
  motivo?: string
  monto_devuelto: number
  genera_nota_credito: boolean
  cxc_id?: string
  estado: EstadoDevolucion
  notas?: string
  created_at?: string
  // joins
  venta?: { numero?: string; nombre: string; monto: number; cobro: string }
  items?: DevolucionItem[]
}

export interface DevolucionItem {
  id: string
  devolucion_id: string
  venta_item_id?: string
  producto_id?: string
  lote_id?: string
  descripcion: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  producto?: { nombre: string; codigo: string }
}

// ─── DTE — Documentos Tributarios Electrónicos ────────────────────────────────
export type TipoDTE =
  | '01' // Factura (FCF)
  | '03' // Comprobante de Crédito Fiscal (CCF)
  | '04' // Nota de Remisión
  | '05' // Nota de Crédito
  | '06' // Nota de Débito
  | '07' // Comprobante de Retención
  | '08' // Comprobante de Liquidación
  | '09' // Documento Contable de Liquidación
  | '11' // Factura de Exportación
  | '14' // Factura de Sujeto Excluido
  | '15' // Comprobante de Donación

export const TIPO_DTE_LABEL: Record<string, string> = {
  '01': 'Factura (FCF)',
  '03': 'Crédito Fiscal (CCF)',
  '04': 'Nota de Remisión',
  '05': 'Nota de Crédito',
  '06': 'Nota de Débito',
  '07': 'Comprobante Retención',
  '08': 'Comp. Liquidación',
  '09': 'Doc. Cont. Liquidación',
  '11': 'Factura Exportación',
  '14': 'Sujeto Excluido',
  '15': 'Comprobante Donación',
}

export type EstadoDTE = 'PROCESADO' | 'RECHAZADO' | 'CONTINGENCIA' | 'ANULADO' | 'IMPORTADO'

export interface DTE {
  id: string
  // Identificación del documento
  tipo_dte: string                // código '01','03','05'…
  numero_control: string          // Número de control MH  (e.g. DTE-01-M001P001-000000000000001)
  codigo_generacion: string       // UUID único del documento
  sello_recepcion?: string        // Sello MH (si fue transmitido)
  // Emisor
  emisor_nit?: string
  emisor_nombre?: string
  emisor_nrc?: string
  // Receptor
  receptor_nombre: string
  receptor_nit?: string
  receptor_nrc?: string
  receptor_tipo_doc?: string
  // Montos
  fecha_emision: string           // YYYY-MM-DD
  hora_emision?: string
  total_no_sujeto?: number
  total_exento?: number
  total_gravado: number
  sub_total?: number
  iva_retenido?: number
  total_pagar: number
  // Estado
  estado: EstadoDTE
  ambiente?: string               // '00' pruebas / '01' producción
  // Vinculación ERP
  venta_id?: string               // FK opcional a disabi_ventas
  // JSON original completo
  json_original: Record<string, unknown>
  // Metadata
  archivo_origen?: string         // nombre del archivo .json subido
  notas?: string
  created_at?: string
  // join
  venta?: { numero?: string; nombre: string }
}

// ─── Conciliación Bancaria ────────────────────────────────────────────────────
export type TipoMovBanco = 'credito' | 'debito'
export type TipoMatchBanco = 'venta' | 'cxc_abono' | 'cpp_pago' | 'gasto' | 'manual'

export interface MovimientoBanco {
  id: string
  fecha: string
  descripcion: string
  referencia?: string
  tipo: TipoMovBanco
  monto: number
  saldo_banco?: number
  cuenta: string
  conciliado: boolean
  tipo_match?: TipoMatchBanco
  referencia_erp?: string
  notas?: string
  created_at?: string
}

// ─── Historial de Precios ─────────────────────────────────────────────────────
export interface PrecioHistorial {
  id: string
  producto_id: string
  precio_venta_anterior?: number
  precio_venta_nuevo: number
  costo_anterior?: number
  costo_nuevo?: number
  motivo?: string
  usuario_email?: string
  created_at?: string
}

// ─── Metas de Ventas ──────────────────────────────────────────────────────────
export interface MetaVentas {
  id: string
  periodo: string            // YYYY-MM
  vendedor_id?: string
  meta_monto: number
  meta_unidades?: number
  notas?: string
  created_at?: string
  // join
  vendedor?: { nombre: string; cargo?: string }
}

// ─── Portal de Cliente ────────────────────────────────────────────────────────
export interface PortalToken {
  id: string
  cliente_id: string
  token: string
  activo: boolean
  ultimo_acceso?: string
  created_at?: string
  // join
  cliente?: { nombre: string; email?: string; telefono?: string }
}

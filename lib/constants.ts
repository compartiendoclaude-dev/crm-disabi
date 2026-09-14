import type { Rol } from './types'

export const IVA_RATE = 0.13

export const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Credito', 'Link de Pago', 'Pago POS'] as const

export const LIQUIDACION_PCT: Record<string, number> = {
  'Link de Pago': 3.29,
  'Pago POS': 2.66,
}

export const ESTADOS_COBRO = {
  Cobrado:               { label: 'Pagado',            color: 'green'  },
  Pendiente:             { label: 'Crédito',           color: 'amber'  },
  Borrador:              { label: 'Borrador',           color: 'gray'   },
  Parcial:               { label: 'Parcial',            color: 'purple' },
  Liquidacion_Pendiente: { label: 'Liquidación pend.', color: 'teal'   },
} as const

export const DIAS_CREDITO = [15, 30, 45, 60] as const

export const PAQUETERAS = {
  XPRESS:  { nombre: 'XPRESS',  costoEnvio: 3.90, comisionPct: 2.5 },
  RAPI:    { nombre: 'RAPI',    costoEnvio: 3.50, comisionPct: 1.0 },
  FORZA:   { nombre: 'FORZA',   costoEnvio: 3.50, comisionPct: 1.0 },
  FOURBOX: { nombre: 'FOURBOX', costoEnvio: 3.00, comisionPct: 0.5 },
} as const

export const ROLES: Record<Rol, { label: string; color: string }> = {
  admin:    { label: 'Administrador', color: 'red'    },
  socio:    { label: 'Socio',         color: 'purple' },
  ventas:   { label: 'Ventas',        color: 'blue'   },
  finanzas: { label: 'Finanzas',      color: 'green'  },
}

export const PERMISOS: Record<Rol, Record<string, boolean | 'read'>> = {
  admin: {
    dashboard: true, ventas: true, inventario: true, compras: true,
    clientes: true, finanzas: true, reportes: true, proyecciones: true, planilla: true,
    dte: true, contabilidad: true,
  },
  socio: {
    dashboard: 'read', ventas: 'read', inventario: 'read', compras: 'read',
    clientes: 'read', finanzas: 'read', reportes: 'read', proyecciones: 'read', planilla: 'read',
    dte: 'read', contabilidad: 'read',
  },
  ventas: {
    dashboard: 'read', ventas: true, inventario: 'read', compras: false,
    clientes: true, finanzas: false, reportes: 'read', proyecciones: false, planilla: false,
    dte: false, contabilidad: false,
  },
  finanzas: {
    // El contador ejecuta estos procesos (no solo los consulta): Finanzas
    // (CxC/CPP/gastos/costos fijos/cierre mensual), Compras (importaciones y
    // compras locales) y Planilla (pagos y comisiones) pasan a permiso total.
    // Ventas/Dashboard/Reportes/Proyecciones se quedan de solo lectura porque
    // no son procesos que el contador registre. Inventario y Clientes siguen
    // sin acceso — no son de su área. Contabilidad pasa a permiso total: el
    // contador es quien captura asientos manuales (depreciación, provisiones,
    // correcciones) y cierra cada ejercicio — los únicos POST que tiene ese
    // módulo — además de ver los reportes que ya se generan solos.
    dashboard: 'read', ventas: 'read', inventario: false, compras: true,
    clientes: false, finanzas: true, reportes: 'read', proyecciones: 'read', planilla: true,
    dte: true, contabilidad: true,
  },
}

// ── Permisos angostos ─────────────────────────────────────────────────────────
// Capacidades puntuales que NO dependen de tener el módulo completo (PERMISOS
// de arriba). Se usan cuando un rol necesita ejecutar UNA acción específica de
// otro módulo sin heredar todo lo demás de ese módulo — por ejemplo, Ventas no
// tiene el módulo Finanzas ni DTE completos, pero sí necesita poder subir el
// DTE de la venta que acaba de registrar y registrar gastos operativos
// variables del día a día. Cada ruta de API decide, acción por acción, si
// consulta esta tabla como excepción a su chequeo de módulo normal.
export const PERMISOS_EXTRA: Partial<Record<Rol, Record<string, boolean>>> = {
  ventas: {
    dte_venta:        true, // subir un DTE (JSON) y vincularlo a la venta que se acaba de registrar
    gastos_variables: true, // registrar (no editar/eliminar) gastos con tipo_egreso = 'operativo'
  },
}

export const USUARIOS_SISTEMA = [
  { nombre: 'José Roberto Chávez', email: 'joserobertochavezjuarez@outlook.com', rol: 'admin'    as Rol },
  { nombre: 'José Roberto Chávez', email: 'admin@datavisualsv.xyz',              rol: 'admin'    as Rol },
  { nombre: 'Jennifer Vides',       email: 'jvides04@gmail.com',                  rol: 'admin'    as Rol },
  { nombre: 'Carlos Boris Joya',    email: 'bjoya19@gmail.com',                   rol: 'socio'    as Rol },
  { nombre: 'Mónica Ramos',         email: 'monica.ramos@saboresideales.com',      rol: 'ventas'   as Rol },
  { nombre: 'Marcela Chacón',       email: 'marcela.chacon@saboresideales.com',    rol: 'ventas'   as Rol },
  { nombre: 'Contador',             email: 'contador@saboresideales.com',           rol: 'finanzas' as Rol },
]

// 9 módulos — Suscripciones descartada, Planilla nuevo
export const NAV_ITEMS = [
  { href: '/dashboard',    label: 'Resumen',      icon: '📊', modulo: 'dashboard'    },
  { href: '/ventas',       label: 'Ventas',       icon: '💰', modulo: 'ventas'       },
  { href: '/inventario',   label: 'Inventario',   icon: '📦', modulo: 'inventario'   },
  { href: '/compras',      label: 'Compras',      icon: '🛒', modulo: 'compras'      },
  { href: '/clientes',     label: 'Clientes',     icon: '👥', modulo: 'clientes'     },
  { href: '/finanzas',     label: 'Finanzas',     icon: '⚖️', modulo: 'finanzas'     },
  { href: '/contabilidad', label: 'Contabilidad', icon: '📒', modulo: 'contabilidad' },
  { href: '/planilla',     label: 'Planilla',     icon: '👨‍💼', modulo: 'planilla'     },
  { href: '/reportes',     label: 'Reportes',     icon: '📈', modulo: 'reportes'     },
  { href: '/proyecciones', label: 'Proyecciones', icon: '🔭', modulo: 'proyecciones' },
  { href: '/dte',          label: 'DTE',          icon: '🧾', modulo: 'dte'          },
] as const

export const SECTORES = ['Cafetería', 'Restaurante', 'Hotel', 'Distribuidora',
  'Supermercado', 'Repostería', 'Otro'] as const

export const CANALES = ['Mostrador', 'WhatsApp', 'Teléfono', 'Pedido web', 'Referido', 'Otro'] as const

// Oportunidades — etapas del embudo comercial. Ganada/Perdida son terminales
// (fecha_cierre_real se llena automáticamente al llegar a cualquiera de las dos).
export const ETAPAS_OPORTUNIDAD = ['Prospección', 'Calificación', 'Propuesta', 'Negociación', 'Ganada', 'Perdida'] as const
export const ETAPAS_OPORTUNIDAD_ABIERTAS = ['Prospección', 'Calificación', 'Propuesta', 'Negociación'] as const
export const ETAPA_COLOR: Record<string, string> = {
  'Prospección':  'gray',
  'Calificación': 'blue',
  'Propuesta':    'purple',
  'Negociación':  'amber',
  'Ganada':       'green',
  'Perdida':      'red',
}

// Planilla — tasas El Salvador
export const PLANILLA = {
  ISSS_EMPLEADO:  0.03,    // 3% sobre salario bruto
  AFP_EMPLEADO:   0.0725,  // 7.25% sobre salario bruto
  RETENCION_HONORARIOS: 0.10, // 10% retención ISR honorarios profesionales (Art. 156 LISR)
  ISSS_PATRONAL:  0.075,   // 7.5% aporte patronal
  AFP_PATRONAL:   0.0875,  // 8.75% aporte patronal
  RENTA_MINIMO:   487.60,  // mínimo exento de renta mensual (2024)
} as const

// Categorías de comisión (tabla maestra "Cálculo automático de Comisiones DISABI") —
// independientes de la categoría de Inventario (Sabores/Otro/Insumo/Licencias, que
// nunca calzó con estas). Cada producto se etiqueta con una de estas para que el
// cálculo de comisiones lo pueda emparejar contra disabi_comision_rangos.
export const CATEGORIAS_COMISION = [
  'Saborizantes',
  'Dispensadores Saborizantes',
  'Salsas',
  'Dispensadores Salsas',
  'Cafe',
  'Matcha puro Barista',
  'Matcha Ceremonial The Coffee',
  'Base de frappe Chai',
  'Base de frappe Vainilla',
  'Base de frappe Chocolate',
  'Articulos de Bar',
  'Tazas',
] as const

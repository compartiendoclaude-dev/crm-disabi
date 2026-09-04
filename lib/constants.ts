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
    dte: true,
  },
  socio: {
    dashboard: 'read', ventas: 'read', inventario: 'read', compras: 'read',
    clientes: 'read', finanzas: 'read', reportes: 'read', proyecciones: 'read', planilla: 'read',
    dte: 'read',
  },
  ventas: {
    dashboard: 'read', ventas: true, inventario: 'read', compras: false,
    clientes: true, finanzas: false, reportes: 'read', proyecciones: false, planilla: false,
    dte: false,
  },
  finanzas: {
    dashboard: 'read', ventas: 'read', inventario: false, compras: 'read',
    clientes: false, finanzas: 'read', reportes: 'read', proyecciones: 'read', planilla: 'read',
    dte: true,
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
  { href: '/planilla',     label: 'Planilla',     icon: '👨‍💼', modulo: 'planilla'     },
  { href: '/reportes',     label: 'Reportes',     icon: '📈', modulo: 'reportes'     },
  { href: '/proyecciones', label: 'Proyecciones', icon: '🔭', modulo: 'proyecciones' },
  { href: '/dte',          label: 'DTE',          icon: '🧾', modulo: 'dte'          },
] as const

export const SECTORES = ['Cafetería', 'Restaurante', 'Hotel', 'Distribuidora',
  'Supermercado', 'Repostería', 'Otro'] as const

export const CANALES = ['Mostrador', 'WhatsApp', 'Teléfono', 'Pedido web', 'Referido', 'Otro'] as const

// Planilla — tasas El Salvador
export const PLANILLA = {
  ISSS_EMPLEADO:  0.03,    // 3% sobre salario bruto
  AFP_EMPLEADO:   0.0725,  // 7.25% sobre salario bruto
  RETENCION_HONORARIOS: 0.10, // 10% retención ISR honorarios profesionales (Art. 156 LISR)
  ISSS_PATRONAL:  0.075,   // 7.5% aporte patronal
  AFP_PATRONAL:   0.0875,  // 8.75% aporte patronal
  RENTA_MINIMO:   487.60,  // mínimo exento de renta mensual (2024)
} as const

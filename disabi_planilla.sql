-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Planilla (ejecutar cuando arranche el módulo Planilla)
-- ══════════════════════════════════════════════════════════════════

-- 1. Empleados
CREATE TABLE IF NOT EXISTS disabi_empleados (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  cargo           TEXT,
  departamento    TEXT,
  salario_base    NUMERIC NOT NULL DEFAULT 0,
  fecha_ingreso   DATE,
  dui             TEXT,
  nit             TEXT,
  nup_isss        TEXT,
  nup_afp         TEXT,
  afp             TEXT CHECK (afp IN ('CRECER','CONFIA')),
  tipo_contrato   TEXT NOT NULL DEFAULT 'empleado' CHECK (tipo_contrato IN ('empleado','honorarios')),
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Registros de planilla mensual
CREATE TABLE IF NOT EXISTS disabi_planilla (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id          UUID NOT NULL REFERENCES disabi_empleados(id),
  tipo_pago            TEXT NOT NULL DEFAULT 'empleado' CHECK (tipo_pago IN ('empleado','honorarios')),
  periodo              TEXT NOT NULL,            -- YYYY-MM
  salario_bruto        NUMERIC NOT NULL DEFAULT 0,
  isss_empleado        NUMERIC NOT NULL DEFAULT 0,   -- 3%
  afp_empleado         NUMERIC NOT NULL DEFAULT 0,   -- 7.25%
  renta                NUMERIC NOT NULL DEFAULT 0,   -- ISR retenido
  otras_deducciones    NUMERIC NOT NULL DEFAULT 0,
  total_deducciones    NUMERIC NOT NULL DEFAULT 0,
  bonos                NUMERIC NOT NULL DEFAULT 0,
  salario_neto         NUMERIC NOT NULL DEFAULT 0,
  isss_patronal        NUMERIC NOT NULL DEFAULT 0,   -- 7.5% (informativo)
  afp_patronal         NUMERIC NOT NULL DEFAULT 0,   -- 8.75% (informativo)
  costo_total_empresa  NUMERIC NOT NULL DEFAULT 0,
  estado               TEXT NOT NULL DEFAULT 'Pendiente'
                         CHECK (estado IN ('Pendiente','Pagado','Anulado')),
  fecha_pago           DATE,
  notas                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empleado_id, periodo)
);

-- 3. RLS
ALTER TABLE disabi_empleados ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabi_planilla  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_empleados" ON disabi_empleados FOR ALL TO authenticated USING (true);
CREATE POLICY "auth_planilla"  ON disabi_planilla  FOR ALL TO authenticated USING (true);

-- 4. Índices
CREATE INDEX IF NOT EXISTS idx_planilla_periodo     ON disabi_planilla(periodo);
CREATE INDEX IF NOT EXISTS idx_planilla_empleado_id ON disabi_planilla(empleado_id);
CREATE INDEX IF NOT EXISTS idx_empleados_activo     ON disabi_empleados(activo);

-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Módulo de Comisiones
-- Ejecutar en Supabase después de disabi_planilla.sql
-- ══════════════════════════════════════════════════════════════════

-- 1. Tabla maestra: rangos de comisión por categoría y precio
CREATE TABLE IF NOT EXISTS disabi_comision_rangos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria       TEXT NOT NULL,           -- Saborizantes | Dispensadores Saborizantes | Salsas | etc.
  precio_iva_desc TEXT NOT NULL,           -- Descripción del rango ("≥13" / "$10.76-$12.99" / etc.)
  precio_min_iva  NUMERIC,                 -- Precio mínimo con IVA del rango (NULL = sin límite inferior)
  precio_max_iva  NUMERIC,                 -- Precio máximo con IVA del rango (NULL = sin límite superior)
  precio_sin_iva  NUMERIC NOT NULL,        -- Precio promedio sin IVA usado para el cálculo
  pct_comision    NUMERIC NOT NULL,        -- % de comisión (ej: 0.05 = 5%)
  orden           INTEGER DEFAULT 0,       -- Para ordenar los rangos de mayor a menor precio
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 2. Registros de comisión mensual por empleado
CREATE TABLE IF NOT EXISTS disabi_comision_registros (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id        UUID NOT NULL REFERENCES disabi_empleados(id),
  periodo            TEXT NOT NULL,         -- YYYY-MM
  fecha_pago_prog    DATE,                  -- Segundo lunes hábil del mes (calculado)
  -- Totales
  comision_bruta     NUMERIC NOT NULL DEFAULT 0,   -- Suma de todas las líneas
  retencion_isr      NUMERIC NOT NULL DEFAULT 0,   -- ISR descontado (10% honorarios / tabla empleado)
  comision_neta      NUMERIC NOT NULL DEFAULT 0,   -- Lo que se paga al vendedor
  tipo_calculo       TEXT NOT NULL DEFAULT 'honorarios'
                       CHECK (tipo_calculo IN ('empleado', 'honorarios')),
  estado             TEXT NOT NULL DEFAULT 'Pendiente'
                       CHECK (estado IN ('Pendiente', 'Pagado', 'Bloqueado')),  -- Bloqueado = crédito pendiente
  fecha_pago_real    DATE,
  notas              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empleado_id, periodo)
);

-- 3. Líneas de detalle del cálculo de comisión
CREATE TABLE IF NOT EXISTS disabi_comision_lineas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comision_registro_id UUID NOT NULL REFERENCES disabi_comision_registros(id) ON DELETE CASCADE,
  rango_id            UUID REFERENCES disabi_comision_rangos(id),
  categoria           TEXT NOT NULL,
  precio_iva_desc     TEXT NOT NULL,
  precio_sin_iva      NUMERIC NOT NULL,
  pct_comision        NUMERIC NOT NULL,
  cantidad_vendida    INTEGER NOT NULL DEFAULT 0,
  comision_linea      NUMERIC NOT NULL DEFAULT 0,   -- cantidad × precio_sin_iva × pct_comision
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 4. RLS
ALTER TABLE disabi_comision_rangos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabi_comision_registros ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabi_comision_lineas    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_comision_rangos"    ON disabi_comision_rangos    FOR ALL TO authenticated USING (true);
CREATE POLICY "auth_comision_registros" ON disabi_comision_registros FOR ALL TO authenticated USING (true);
CREATE POLICY "auth_comision_lineas"    ON disabi_comision_lineas    FOR ALL TO authenticated USING (true);

-- 5. Índices
CREATE INDEX IF NOT EXISTS idx_comision_reg_periodo    ON disabi_comision_registros(periodo);
CREATE INDEX IF NOT EXISTS idx_comision_reg_empleado   ON disabi_comision_registros(empleado_id);
CREATE INDEX IF NOT EXISTS idx_comision_lineas_reg_id  ON disabi_comision_lineas(comision_registro_id);

-- ══════════════════════════════════════════════════════════════════
-- 6. Datos iniciales: tabla maestra de rangos DISABI 2026
-- ══════════════════════════════════════════════════════════════════
INSERT INTO disabi_comision_rangos
  (categoria, precio_iva_desc, precio_min_iva, precio_max_iva, precio_sin_iva, pct_comision, orden)
VALUES
  -- Saborizantes
  ('Saborizantes',             '≥ $13.00',           13,    NULL,  11.5,       0.05, 1),
  ('Saborizantes',             '$10.76 - $12.99',    10.76, 12.99, 10.50885,   0.04, 2),
  ('Saborizantes',             '$10.00 - $10.75',    10.00, 10.75, 9.181416,   0.02, 3),
  ('Saborizantes',             '$9.00 - $9.99',       9.00,  9.99, 8.845133,   0.015,4),
  ('Saborizantes',             '$8.50 - $8.99',       8.50,  8.99, 7.738938,   0.01, 5),

  -- Dispensadores Saborizantes
  ('Dispensadores Saborizantes','$7.00',              7.00,  7.00, 6.2,        0.05, 1),
  ('Dispensadores Saborizantes','$6.00',              6.00,  6.00, 5.31,       0.04, 2),
  ('Dispensadores Saborizantes','$5.00',              5.00,  5.00, 4.42,       0.02, 3),
  ('Dispensadores Saborizantes','$3.00 - $4.99',      3.00,  4.99, 3.535398,   0.015,4),

  -- Salsas
  ('Salsas',                   '≥ $25.25',           25.25, NULL,  22.35,      0.05, 1),
  ('Salsas',                   '$24.00 - $25.24',    24.00, 25.24, 21.787611,  0.04, 2),
  ('Salsas',                   '$22.00 - $23.99',    22.00, 23.99, 20.349558,  0.02, 3),
  ('Salsas',                   '$19.30 - $21.99',    19.30, 21.99, 18.269911,  0.015,4),

  -- Dispensadores Salsas
  ('Dispensadores Salsas',     '$15.00',             15.00, 15.00, 13.27,      0.04, 1),
  ('Dispensadores Salsas',     '$13.00 - $14.99',    13.00, 14.99, 12.384956,  0.02, 2),

  -- Café
  ('Cafe',                     '$8.50',               8.50,  8.50, 7.522124,   0.04, 1),
  ('Cafe',                     '$6.50 - $8.49',       6.50,  8.49, 7.51,       0.02, 2)

ON CONFLICT DO NOTHING;

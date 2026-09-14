-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Módulo de Oportunidades (embudo comercial)
-- ══════════════════════════════════════════════════════════════════
-- Hoy el área comercial no deja registro de nada hasta que existe una
-- Cotización formal — no hay dónde anotar un prospecto, en qué etapa
-- va la negociación, el valor estimado, la probabilidad de cierre, ni
-- por qué se perdió un trato. Esta tabla agrega esa etapa previa:
--
--   Oportunidad  →  Cotización  →  Venta
--   (prospecto)     (propuesta      (cierre)
--                    formal)
--
-- El vínculo hacia adelante ya existe en cada eslabón:
--   - disabi_cotizaciones.oportunidad_id (nueva, este script) apunta
--     a la oportunidad que la originó.
--   - disabi_cxc.venta_id / disabi_cotizaciones.venta_id ya vinculan
--     Cotización/PP con la Venta (ver disabi_cxc_venta_link.sql).
-- Así que desde una Oportunidad se puede llegar a su Venta final
-- siguiendo esos dos vínculos, sin duplicar el dato en ambos sentidos.
--
-- Por decisión explícita de José: no se construyen reportes todavía,
-- pero los datos (fecha de creación, fecha de cierre, etapa, motivo de
-- pérdida) quedan guardados desde ya para poder reportar después
-- cuántas oportunidades se vieron por día/semana/mes y la tasa de
-- conversión del embudo.
--
-- Ejecutar una sola vez. Idempotente.
-- ══════════════════════════════════════════════════════════════════

-- ── Tabla principal ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_oportunidades (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  numero                TEXT NOT NULL,

  -- Prospecto — texto libre igual que disabi_cotizaciones.cliente (no todo
  -- prospecto es todavía un cliente registrado). cliente_id es opcional: se
  -- llena solo cuando el prospecto ya existe en el catálogo de clientes.
  cliente               TEXT NOT NULL,
  cliente_id            UUID REFERENCES disabi_clientes(id) ON DELETE SET NULL,
  contacto              TEXT,
  telefono              TEXT,
  email                 TEXT,
  sector                TEXT,
  canal                 TEXT,               -- origen: mismo catálogo que CANALES (Mostrador, WhatsApp, Referido, etc.)

  descripcion           TEXT,               -- qué necesita / qué se está negociando
  valor_estimado        NUMERIC DEFAULT 0,
  probabilidad_pct      INTEGER DEFAULT 20 CHECK (probabilidad_pct BETWEEN 0 AND 100),

  etapa                 TEXT NOT NULL DEFAULT 'Prospección'
                          CHECK (etapa IN ('Prospección','Calificación','Propuesta','Negociación','Ganada','Perdida')),
  motivo_perdida        TEXT,               -- solo aplica si etapa = 'Perdida'

  fecha_estimada_cierre DATE,
  fecha_cierre_real     DATE,               -- se llena automáticamente al pasar a Ganada/Perdida

  proxima_accion        TEXT,
  fecha_proxima_accion  DATE,
  notas                 TEXT,

  vendedor_id           UUID REFERENCES disabi_empleados(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_oportunidades_etapa      ON disabi_oportunidades(etapa);
CREATE INDEX IF NOT EXISTS idx_oportunidades_created    ON disabi_oportunidades(created_at);
CREATE INDEX IF NOT EXISTS idx_oportunidades_cliente_id ON disabi_oportunidades(cliente_id);
CREATE INDEX IF NOT EXISTS idx_oportunidades_vendedor    ON disabi_oportunidades(vendedor_id);

-- ── Vínculo hacia la Cotización que nace de una Oportunidad ───────────────────
ALTER TABLE disabi_cotizaciones ADD COLUMN IF NOT EXISTS oportunidad_id UUID REFERENCES disabi_oportunidades(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cotizaciones_oportunidad ON disabi_cotizaciones(oportunidad_id);

-- ── RLS — mismo patrón que el resto de tablas disabi_* (control de acceso
-- real vive en la app vía PERMISOS de lib/constants.ts, no en RLS) ────────────
ALTER TABLE disabi_oportunidades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'disabi_oportunidades' AND policyname = 'disabi_oportunidades_auth'
  ) THEN
    CREATE POLICY disabi_oportunidades_auth ON disabi_oportunidades
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Verificación (opcional, solo lectura):
-- SELECT id, numero, cliente, etapa, valor_estimado, probabilidad_pct, created_at
-- FROM disabi_oportunidades ORDER BY created_at DESC LIMIT 20;

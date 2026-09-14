-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Prioridad 1: Vendedor por venta + Límite de crédito
-- Ejecutar en Supabase SQL Editor ANTES del deploy
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. VENDEDOR ASIGNADO POR VENTA ───────────────────────────────
-- Agrega referencia al empleado (vendedor) en cada venta

ALTER TABLE disabi_ventas
  ADD COLUMN IF NOT EXISTS vendedor_id UUID REFERENCES disabi_empleados(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON disabi_ventas(vendedor_id);

-- Vista útil para comisiones por vendedor
CREATE OR REPLACE VIEW disabi_ventas_con_vendedor AS
SELECT
  v.*,
  e.nombre  AS vendedor_nombre,
  e.cargo   AS vendedor_cargo
FROM disabi_ventas v
LEFT JOIN disabi_empleados e ON e.id = v.vendedor_id;

-- ─── 2. LÍMITE DE CRÉDITO + PAÍS EN CLIENTES ──────────────────────
-- Agrega límite de crédito y país al maestro de clientes

ALTER TABLE disabi_clientes
  ADD COLUMN IF NOT EXISTS pais          TEXT    DEFAULT 'El Salvador',
  ADD COLUMN IF NOT EXISTS limite_credito NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notas         TEXT;

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (ejecutar después para confirmar)
-- ══════════════════════════════════════════════════════════════════
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('disabi_ventas','disabi_clientes')
--     AND column_name IN ('vendedor_id','pais','limite_credito','notas')
--   ORDER BY table_name, column_name;

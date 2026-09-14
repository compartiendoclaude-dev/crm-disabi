-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Cierre Mensual (bloqueo de período contable)
-- ══════════════════════════════════════════════════════════════════
-- Antes no existía ningún bloqueo: se podía crear o editar una venta,
-- un gasto, un abono, un pago de planilla/comisión, etc. con fecha de
-- un mes ya reportado, y el Estado de Resultados de ese mes cambiaba
-- en silencio. Esta tabla es el "candado": si existe una fila para el
-- período 'YYYY-MM', ese mes queda cerrado y la app rechaza cualquier
-- creación/edición con fecha dentro de ese mes en Ventas, Gastos, CxC,
-- CPP, Planilla, Comisiones, Costos Fijos, Compras y Devoluciones.
--
-- Ejecutar una sola vez. Idempotente.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS disabi_cierres_mensuales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo     TEXT NOT NULL UNIQUE,   -- 'YYYY-MM'
  cerrado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por UUID REFERENCES auth.users(id),
  notas       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_cierres_mensuales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_cierres" ON disabi_cierres_mensuales;
CREATE POLICY "auth_cierres" ON disabi_cierres_mensuales FOR ALL TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_cierres_periodo ON disabi_cierres_mensuales(periodo);

-- Verificación (opcional, solo lectura):
-- SELECT * FROM disabi_cierres_mensuales ORDER BY periodo DESC;

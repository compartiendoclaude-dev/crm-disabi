-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Corrección de puentes financieros
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Clasificador de tipo de egreso en disabi_gastos
--    Permite desglosar el Estado de Resultados correctamente:
--    'operativo'     → gastos variables del negocio (insumos, transporte, etc.)
--    'costo_canal'   → paquetera, comisión Link de Pago, comisión POS
--    'compra_local'  → compras locales a proveedores
--    'planilla'      → sueldos y honorarios pagados
--    'comision_venta'→ comisiones a vendedores pagadas
ALTER TABLE disabi_gastos
  ADD COLUMN IF NOT EXISTS tipo_egreso TEXT
    DEFAULT 'operativo'
    CHECK (tipo_egreso IN (
      'operativo', 'costo_canal', 'compra_local', 'planilla', 'comision_venta'
    ));

-- 2. Retroactivamente: clasificar compras locales ya registradas
UPDATE disabi_gastos
  SET tipo_egreso = 'compra_local'
  WHERE tipo_compra = 'Local' AND (tipo_egreso IS NULL OR tipo_egreso = 'operativo');

-- 3. CPP: campo para origen del registro (manual vs generado desde compra)
ALTER TABLE disabi_cpp
  ADD COLUMN IF NOT EXISTS origen TEXT DEFAULT 'manual'
    CHECK (origen IN ('manual', 'compra_importacion', 'compra_local'));

ALTER TABLE disabi_cpp
  ADD COLUMN IF NOT EXISTS origen_id UUID;  -- FK al registro de compra que lo generó

-- 4. Verificación: ver el estado actual de disabi_gastos
-- (ejecutar esta query por separado para confirmar)
-- SELECT tipo_egreso, COUNT(*), SUM(monto)
-- FROM disabi_gastos
-- GROUP BY tipo_egreso
-- ORDER BY tipo_egreso;

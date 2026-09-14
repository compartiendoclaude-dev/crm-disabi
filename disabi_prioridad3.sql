-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Prioridad 3: Estado de Cuenta + Conciliación Bancaria
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─── Conciliación bancaria ────────────────────────────────────────
-- Movimientos importados del estado de cuenta bancario
CREATE TABLE IF NOT EXISTS disabi_movimientos_banco (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha           DATE        NOT NULL,
  descripcion     TEXT        NOT NULL,
  referencia      TEXT,                           -- número de referencia del banco
  tipo            TEXT        NOT NULL            -- 'credito' | 'debito'
                  CHECK (tipo IN ('credito','debito')),
  monto           NUMERIC     NOT NULL,
  saldo_banco     NUMERIC,                        -- saldo acumulado según banco
  cuenta          TEXT        DEFAULT 'Principal', -- nombre de cuenta bancaria
  -- Conciliación
  conciliado      BOOLEAN     DEFAULT false,
  tipo_match      TEXT,                           -- 'venta' | 'cxc_abono' | 'cpp_pago' | 'gasto' | 'manual'
  referencia_erp  UUID,                           -- id del registro ERP relacionado
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_movimientos_banco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_banco" ON disabi_movimientos_banco FOR ALL TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_banco_fecha      ON disabi_movimientos_banco(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_banco_conciliado ON disabi_movimientos_banco(conciliado);
CREATE INDEX IF NOT EXISTS idx_banco_tipo       ON disabi_movimientos_banco(tipo);
CREATE INDEX IF NOT EXISTS idx_banco_monto      ON disabi_movimientos_banco(monto);

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- SELECT tipo, COUNT(*), SUM(monto) FROM disabi_movimientos_banco GROUP BY tipo;
-- SELECT COUNT(*) FILTER (WHERE conciliado) AS conciliados,
--        COUNT(*) FILTER (WHERE NOT conciliado) AS pendientes
-- FROM disabi_movimientos_banco;
-- ══════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Historial de precios + Metas de ventas + Portal cliente
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. HISTORIAL DE PRECIOS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_precios_historial (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     UUID        NOT NULL REFERENCES disabi_productos(id) ON DELETE CASCADE,
  precio_venta_anterior NUMERIC,
  precio_venta_nuevo    NUMERIC NOT NULL,
  costo_anterior        NUMERIC,
  costo_nuevo           NUMERIC,
  motivo          TEXT,                         -- 'ajuste', 'proveedor', 'campaña', etc.
  usuario_email   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_precios_historial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_precios_hist" ON disabi_precios_historial FOR ALL TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_precio_hist_producto ON disabi_precios_historial(producto_id, created_at DESC);

-- Trigger que registra automáticamente cambios de precio
CREATE OR REPLACE FUNCTION fn_precio_historial()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
BEGIN
  -- Solo actuar si cambiaron precio_venta o precio_costo
  IF (OLD.precio_venta IS DISTINCT FROM NEW.precio_venta)
  OR (OLD.precio_costo IS DISTINCT FROM NEW.precio_costo) THEN
    SELECT email INTO v_email FROM auth.users WHERE id = auth.uid() LIMIT 1;
    INSERT INTO disabi_precios_historial (
      producto_id,
      precio_venta_anterior, precio_venta_nuevo,
      costo_anterior,        costo_nuevo,
      usuario_email
    ) VALUES (
      NEW.id,
      OLD.precio_venta, NEW.precio_venta,
      OLD.precio_costo, NEW.precio_costo,
      v_email
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_precio_historial ON disabi_productos;
CREATE TRIGGER tg_precio_historial
  AFTER UPDATE ON disabi_productos
  FOR EACH ROW EXECUTE FUNCTION fn_precio_historial();

-- ─── 2. METAS DE VENTAS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_metas_ventas (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo         TEXT        NOT NULL,           -- YYYY-MM
  vendedor_id     UUID        REFERENCES disabi_empleados(id) ON DELETE SET NULL,
  -- NULL = meta global del negocio
  meta_monto      NUMERIC     NOT NULL DEFAULT 0,
  meta_unidades   INTEGER,                        -- opcional
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (periodo, vendedor_id)
);

ALTER TABLE disabi_metas_ventas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_metas" ON disabi_metas_ventas FOR ALL TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_metas_periodo ON disabi_metas_ventas(periodo DESC);

-- ─── 3. TOKENS PORTAL DE CLIENTE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_portal_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      UUID        NOT NULL REFERENCES disabi_clientes(id) ON DELETE CASCADE,
  token           TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  activo          BOOLEAN     DEFAULT true,
  ultimo_acceso   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_portal_tokens ENABLE ROW LEVEL SECURITY;
-- Token público: solo SELECT por token, sin auth requerida
CREATE POLICY "portal_public_read" ON disabi_portal_tokens
  FOR SELECT USING (true);
CREATE POLICY "portal_auth_write" ON disabi_portal_tokens
  FOR ALL TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_portal_token  ON disabi_portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_portal_cliente ON disabi_portal_tokens(cliente_id);

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- SELECT * FROM disabi_metas_ventas LIMIT 5;
-- SELECT * FROM disabi_precios_historial LIMIT 5;
-- SELECT token FROM disabi_portal_tokens LIMIT 3;
-- ══════════════════════════════════════════════════════════════════

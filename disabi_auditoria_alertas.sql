-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Auditoría + Alertas
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. TABLA DE AUDITORÍA ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_auditoria (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla         TEXT        NOT NULL,
  operacion     TEXT        NOT NULL CHECK (operacion IN ('INSERT','UPDATE','DELETE')),
  registro_id   TEXT,                         -- id del registro afectado
  usuario_id    UUID,                         -- auth.uid() en el momento
  usuario_email TEXT,                         -- email del usuario
  datos_antes   JSONB,                        -- fila antes del cambio (UPDATE/DELETE)
  datos_despues JSONB,                        -- fila después del cambio (INSERT/UPDATE)
  ip            TEXT,                         -- request IP (si disponible)
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_auditoria ENABLE ROW LEVEL SECURITY;
-- Solo admins pueden leer auditoría, nadie puede escribir directamente
CREATE POLICY "audit_read"   ON disabi_auditoria FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_insert" ON disabi_auditoria FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_audit_tabla     ON disabi_auditoria(tabla);
CREATE INDEX IF NOT EXISTS idx_audit_usuario   ON disabi_auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_audit_operacion ON disabi_auditoria(operacion);
CREATE INDEX IF NOT EXISTS idx_audit_fecha     ON disabi_auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_id        ON disabi_auditoria(registro_id);

-- ─── 2. FUNCIÓN TRIGGER genérica ─────────────────────────────────
CREATE OR REPLACE FUNCTION fn_disabi_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_registro_id TEXT;
  v_usuario_id  UUID;
  v_email       TEXT;
BEGIN
  -- ID del registro (columna 'id' en todas las tablas DISABI)
  IF TG_OP = 'DELETE' THEN
    v_registro_id := (OLD.id)::TEXT;
  ELSE
    v_registro_id := (NEW.id)::TEXT;
  END IF;

  -- Usuario actual de Supabase Auth
  v_usuario_id := auth.uid();

  -- Email del usuario (join a auth.users)
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = v_usuario_id
  LIMIT 1;

  INSERT INTO disabi_auditoria (
    tabla, operacion, registro_id,
    usuario_id, usuario_email,
    datos_antes, datos_despues
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    v_registro_id,
    v_usuario_id,
    v_email,
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── 3. TRIGGERS en tablas críticas ──────────────────────────────
-- Ventas (alta prioridad — monto, cobro)
DROP TRIGGER IF EXISTS tg_audit_ventas ON disabi_ventas;
CREATE TRIGGER tg_audit_ventas
  AFTER INSERT OR UPDATE OR DELETE ON disabi_ventas
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Items de venta
DROP TRIGGER IF EXISTS tg_audit_venta_items ON disabi_venta_items;
CREATE TRIGGER tg_audit_venta_items
  AFTER INSERT OR UPDATE OR DELETE ON disabi_venta_items
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Clientes
DROP TRIGGER IF EXISTS tg_audit_clientes ON disabi_clientes;
CREATE TRIGGER tg_audit_clientes
  AFTER INSERT OR UPDATE OR DELETE ON disabi_clientes
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Productos/Inventario
DROP TRIGGER IF EXISTS tg_audit_productos ON disabi_productos;
CREATE TRIGGER tg_audit_productos
  AFTER INSERT OR UPDATE OR DELETE ON disabi_productos
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Movimientos de inventario (Kardex)
DROP TRIGGER IF EXISTS tg_audit_mov_inv ON disabi_movimientos_inv;
CREATE TRIGGER tg_audit_mov_inv
  AFTER INSERT OR UPDATE OR DELETE ON disabi_movimientos_inv
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- CxC
DROP TRIGGER IF EXISTS tg_audit_cxc ON disabi_cxc;
CREATE TRIGGER tg_audit_cxc
  AFTER INSERT OR UPDATE OR DELETE ON disabi_cxc
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Abonos CxC
DROP TRIGGER IF EXISTS tg_audit_cxc_abonos ON disabi_cxc_abonos;
CREATE TRIGGER tg_audit_cxc_abonos
  AFTER INSERT OR UPDATE OR DELETE ON disabi_cxc_abonos
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Gastos
DROP TRIGGER IF EXISTS tg_audit_gastos ON disabi_gastos;
CREATE TRIGGER tg_audit_gastos
  AFTER INSERT OR UPDATE OR DELETE ON disabi_gastos
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Compras
DROP TRIGGER IF EXISTS tg_audit_compras ON disabi_compras;
CREATE TRIGGER tg_audit_compras
  AFTER INSERT OR UPDATE OR DELETE ON disabi_compras
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Planilla
DROP TRIGGER IF EXISTS tg_audit_planilla ON disabi_planilla;
CREATE TRIGGER tg_audit_planilla
  AFTER INSERT OR UPDATE OR DELETE ON disabi_planilla
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Comisiones
DROP TRIGGER IF EXISTS tg_audit_comision_registros ON disabi_comision_registros;
CREATE TRIGGER tg_audit_comision_registros
  AFTER INSERT OR UPDATE OR DELETE ON disabi_comision_registros
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- Devoluciones
DROP TRIGGER IF EXISTS tg_audit_devoluciones ON disabi_devoluciones;
CREATE TRIGGER tg_audit_devoluciones
  AFTER INSERT OR UPDATE OR DELETE ON disabi_devoluciones
  FOR EACH ROW EXECUTE FUNCTION fn_disabi_auditoria();

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- SELECT tabla, operacion, COUNT(*) FROM disabi_auditoria
--   GROUP BY tabla, operacion ORDER BY tabla, operacion;
-- ══════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Maestro de Proveedores, Lotes y Devoluciones
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. MAESTRO DE PROVEEDORES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_proveedores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  razon_social    TEXT,
  nit             TEXT,
  nrc             TEXT,
  contacto        TEXT,
  email           TEXT,
  telefono        TEXT,
  pais            TEXT DEFAULT 'El Salvador',
  direccion       TEXT,
  tipo            TEXT DEFAULT 'local' CHECK (tipo IN ('local','importacion','ambos')),
  moneda          TEXT DEFAULT 'USD' CHECK (moneda IN ('USD','GTQ','EUR','MXN')),
  dias_credito    INTEGER DEFAULT 0,          -- días de crédito típico
  limite_credito  NUMERIC DEFAULT 0,          -- límite de crédito en USD
  notas           TEXT,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE disabi_proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_proveedores" ON disabi_proveedores FOR ALL TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_proveedores_nombre ON disabi_proveedores(nombre);

-- Vincular compras existentes al maestro (FK opcional — NULL si fue texto libre)
ALTER TABLE disabi_compras
  ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES disabi_proveedores(id);

-- ─── 2. CONTROL DE LOTES Y VENCIMIENTOS ───────────────────────────
CREATE TABLE IF NOT EXISTS disabi_lotes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id     UUID NOT NULL REFERENCES disabi_productos(id),
  numero_lote     TEXT NOT NULL,
  fecha_vencimiento DATE NOT NULL,
  fecha_ingreso   DATE DEFAULT CURRENT_DATE,
  cantidad_inicial INTEGER NOT NULL DEFAULT 0,
  cantidad_actual  INTEGER NOT NULL DEFAULT 0,
  compra_id       UUID REFERENCES disabi_compras(id),  -- de qué compra vino
  notas           TEXT,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (producto_id, numero_lote)
);

ALTER TABLE disabi_lotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_lotes" ON disabi_lotes FOR ALL TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_lotes_producto    ON disabi_lotes(producto_id);
CREATE INDEX IF NOT EXISTS idx_lotes_vencimiento ON disabi_lotes(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_lotes_activo      ON disabi_lotes(activo);

-- ─── 3. DEVOLUCIONES DE VENTAS ────────────────────────────────────
-- Una devolución anula total o parcialmente una venta:
-- - Repone stock (Kardex)
-- - Genera nota de crédito en CxC (si había crédito) o devuelve efectivo
-- - NO elimina la venta — la marca como 'Devuelta' o 'Parcialmente Devuelta'
CREATE TABLE IF NOT EXISTS disabi_devoluciones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          TEXT,                          -- NDV-0001
  venta_id        UUID NOT NULL REFERENCES disabi_ventas(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo            TEXT NOT NULL DEFAULT 'total'
                    CHECK (tipo IN ('total','parcial')),
  motivo          TEXT,
  -- Impacto financiero
  monto_devuelto  NUMERIC NOT NULL DEFAULT 0,    -- monto de la devolución
  genera_nota_credito BOOLEAN DEFAULT true,       -- si genera NC en CxC
  cxc_id          UUID REFERENCES disabi_cxc(id),-- CxC afectada (si aplica)
  -- Estado
  estado          TEXT NOT NULL DEFAULT 'Procesada'
                    CHECK (estado IN ('Procesada','Anulada')),
  notas           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disabi_devolucion_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucion_id   UUID NOT NULL REFERENCES disabi_devoluciones(id) ON DELETE CASCADE,
  venta_item_id   UUID REFERENCES disabi_venta_items(id),
  producto_id     UUID REFERENCES disabi_productos(id),
  lote_id         UUID REFERENCES disabi_lotes(id),  -- lote al que regresa
  descripcion     TEXT NOT NULL,
  cantidad        INTEGER NOT NULL,
  precio_unitario NUMERIC NOT NULL,
  subtotal        NUMERIC NOT NULL
);

ALTER TABLE disabi_devoluciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabi_devolucion_items  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_devoluciones"       ON disabi_devoluciones      FOR ALL TO authenticated USING (true);
CREATE POLICY "auth_devolucion_items"   ON disabi_devolucion_items  FOR ALL TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_devoluciones_venta ON disabi_devoluciones(venta_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_fecha ON disabi_devoluciones(fecha);

-- Agregar campo en ventas para estado de devolución
ALTER TABLE disabi_ventas
  ADD COLUMN IF NOT EXISTS devolucion_estado TEXT DEFAULT NULL
    CHECK (devolucion_estado IN ('Devuelta','Parcialmente Devuelta'));

-- ─── 4. UNIDAD en productos — agregar restricción de valores válidos ──
-- (El CHECK no aplica retroactivamente a datos existentes, solo nuevos registros)
-- Los valores permitidos son los mismos del select del frontend
-- No se agrega CHECK para no romper datos históricos con texto libre
-- Solo documentación:
COMMENT ON COLUMN disabi_productos.unidad IS
  'Valores estándar: botella, caja, galón, litro, kg, gramo, unidad, docena, paquete, saco';

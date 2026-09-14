-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Módulo DTE (Documentos Tributarios Electrónicos)
-- Archivo de importación y archivo de DTEs emitidos
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS disabi_dte (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación del documento
  tipo_dte            TEXT        NOT NULL,                         -- '01' FCF, '03' CCF, '05' NC...
  numero_control      TEXT        NOT NULL UNIQUE,                  -- DTE-01-M001P001-000000000000001
  codigo_generacion   TEXT        NOT NULL UNIQUE,                  -- UUID del documento (MH)
  sello_recepcion     TEXT,                                         -- sello MH si fue transmitido

  -- Emisor
  emisor_nit          TEXT,
  emisor_nombre       TEXT,
  emisor_nrc          TEXT,

  -- Receptor
  receptor_nombre     TEXT        NOT NULL DEFAULT '',
  receptor_nit        TEXT,
  receptor_nrc        TEXT,
  receptor_tipo_doc   TEXT,

  -- Montos (en USD)
  fecha_emision       DATE        NOT NULL,
  hora_emision        TEXT,
  total_no_sujeto     NUMERIC     DEFAULT 0,
  total_exento        NUMERIC     DEFAULT 0,
  total_gravado       NUMERIC     DEFAULT 0,
  sub_total           NUMERIC     DEFAULT 0,
  iva_retenido        NUMERIC     DEFAULT 0,
  total_pagar         NUMERIC     NOT NULL DEFAULT 0,

  -- Estado
  estado              TEXT        NOT NULL DEFAULT 'IMPORTADO'
                                  CHECK (estado IN ('PROCESADO','RECHAZADO','CONTINGENCIA','ANULADO','IMPORTADO')),
  ambiente            TEXT        DEFAULT '01',                     -- '00' pruebas / '01' producción

  -- Vinculación ERP
  venta_id            UUID        REFERENCES disabi_ventas(id) ON DELETE SET NULL,

  -- JSON original completo (para trazabilidad total)
  json_original       JSONB       NOT NULL DEFAULT '{}',

  -- Metadata de importación
  archivo_origen      TEXT,
  notas               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE disabi_dte ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_dte" ON disabi_dte FOR ALL TO authenticated USING (true);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_dte_tipo        ON disabi_dte(tipo_dte);
CREATE INDEX IF NOT EXISTS idx_dte_fecha       ON disabi_dte(fecha_emision DESC);
CREATE INDEX IF NOT EXISTS idx_dte_receptor    ON disabi_dte(receptor_nombre);
CREATE INDEX IF NOT EXISTS idx_dte_estado      ON disabi_dte(estado);
CREATE INDEX IF NOT EXISTS idx_dte_venta       ON disabi_dte(venta_id);
CREATE INDEX IF NOT EXISTS idx_dte_json        ON disabi_dte USING gin(json_original);

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- SELECT tipo_dte, COUNT(*), SUM(total_pagar) FROM disabi_dte GROUP BY tipo_dte;
-- ══════════════════════════════════════════════════════════════════

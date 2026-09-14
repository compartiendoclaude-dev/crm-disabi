-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Seguridad Portal de Cliente
-- Ejecutar en Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

-- ─── 1. Expiración de tokens ──────────────────────────────────────
-- Agregar columna expira_at a la tabla existente
ALTER TABLE disabi_portal_tokens
  ADD COLUMN IF NOT EXISTS expira_at TIMESTAMPTZ
    NOT NULL DEFAULT (now() + INTERVAL '30 days');

-- Los tokens existentes sin expiración se vencen en 30 días desde ahora
UPDATE disabi_portal_tokens
  SET expira_at = now() + INTERVAL '30 days'
  WHERE expira_at IS NULL;

-- ─── 2. Log de accesos al portal ─────────────────────────────────
CREATE TABLE IF NOT EXISTS disabi_portal_accesos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id    UUID        NOT NULL REFERENCES disabi_portal_tokens(id) ON DELETE CASCADE,
  cliente_id  UUID        NOT NULL REFERENCES disabi_clientes(id) ON DELETE CASCADE,
  ip          TEXT,
  user_agent  TEXT,
  accessed_at TIMESTAMPTZ DEFAULT now()
);

-- Solo insert público (el portal registra accesos sin auth)
-- Solo lectura autenticada (admins ven los logs)
ALTER TABLE disabi_portal_accesos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accesos_public_insert" ON disabi_portal_accesos
  FOR INSERT WITH CHECK (true);
CREATE POLICY "accesos_auth_select" ON disabi_portal_accesos
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_accesos_token    ON disabi_portal_accesos(token_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_accesos_cliente  ON disabi_portal_accesos(cliente_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_accesos_fecha    ON disabi_portal_accesos(accessed_at DESC);

-- ══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- SELECT token, expira_at, activo FROM disabi_portal_tokens;
-- SELECT ip, user_agent, accessed_at FROM disabi_portal_accesos ORDER BY accessed_at DESC LIMIT 10;
-- ══════════════════════════════════════════════════════════════════

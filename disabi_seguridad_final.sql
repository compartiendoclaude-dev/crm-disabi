-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Seguridad: Correcciones de vulnerabilidades + 2FA
-- ══════════════════════════════════════════════════════════════════

-- ─── NOTA IMPORTANTE ─────────────────────────────────────────────
-- La activación del MFA/TOTP en Supabase NO requiere SQL.
-- Se hace desde el Dashboard de Supabase:
--
--   Authentication → Sign In / Up → Multi Factor Authentication (MFA)
--   → Enable TOTP
--
-- Una vez activado, el código en app/login/page.tsx maneja el flujo
-- automáticamente para los 6 usuarios del sistema.
-- ─────────────────────────────────────────────────────────────────

-- ─── 1. Reforzar RLS en tablas sensibles ─────────────────────────
-- Asegurar que las políticas RLS solo permiten usuarios autenticados

-- Auditoría: solo lectura autenticada, insert desde trigger (SECURITY DEFINER)
DROP POLICY IF EXISTS "auth_read"   ON disabi_auditoria;
DROP POLICY IF EXISTS "audit_read"  ON disabi_auditoria;
DROP POLICY IF EXISTS "audit_insert" ON disabi_auditoria;

CREATE POLICY "auditoria_select" ON disabi_auditoria
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auditoria_insert" ON disabi_auditoria
  FOR INSERT TO authenticated WITH CHECK (true);

-- Portal accesos: insert público (el portal no tiene auth), select autenticado
DROP POLICY IF EXISTS "accesos_public_insert" ON disabi_portal_accesos;
DROP POLICY IF EXISTS "accesos_auth_select"   ON disabi_portal_accesos;

CREATE POLICY "portal_accesos_insert" ON disabi_portal_accesos
  FOR INSERT WITH CHECK (true);

CREATE POLICY "portal_accesos_select" ON disabi_portal_accesos
  FOR SELECT TO authenticated USING (true);

-- ─── 2. Prevenir borrado masivo sin filtro (extra safety) ─────────
-- Supabase ya tiene RLS, pero como capa extra: revocar DELETE global
-- en tablas financieras críticas y exigir filtro por id

-- Las políticas RLS de las tablas principales ya requieren authenticated.
-- Este bloque documenta la intención — no cambia las policies existentes.

-- ─── 3. Verificar que todas las tablas tienen RLS activo ──────────
-- Ejecutar esta query para confirmar:
--
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename LIKE 'disabi_%'
-- ORDER BY tablename;
--
-- Todas deben mostrar rowsecurity = true

-- ─── 4. Índice de seguridad para portal tokens ────────────────────
-- Mejorar búsqueda de tokens activos no expirados
CREATE INDEX IF NOT EXISTS idx_portal_token_activo
  ON disabi_portal_tokens(token)
  WHERE activo = true;

-- ══════════════════════════════════════════════════════════════════
-- CHECKLIST DE ACTIVACIÓN MFA EN SUPABASE
-- ══════════════════════════════════════════════════════════════════
--
-- 1. Ir a supabase.com → proyecto ekalupbolumvwwscojjn
-- 2. Authentication → Sign In / Up
-- 3. Multi Factor Authentication → Enable TOTP ✓
-- 4. Guardar cambios
--
-- Con eso activado, el login del ERP detectará automáticamente:
--   - Usuarios SIN MFA → fuerza enrolamiento con QR al primer login
--   - Usuarios CON MFA → pide código TOTP en cada login
--
-- Apps compatibles para los 6 usuarios:
--   - Google Authenticator (Android/iOS) — RECOMENDADO
--   - Authy (Android/iOS/Desktop) — backup en la nube
--   - Microsoft Authenticator (Android/iOS)
--
-- ══════════════════════════════════════════════════════════════════

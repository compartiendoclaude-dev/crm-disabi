-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Fase 1: tabla de usuarios y roles
-- Ejecutar DESPUÉS de crear los 6 usuarios en Supabase Auth Dashboard
-- ══════════════════════════════════════════════════════════════════

-- 1. Crear tabla de usuarios con roles
CREATE TABLE IF NOT EXISTS disabi_usuarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre     TEXT NOT NULL,
  email      TEXT NOT NULL,
  rol        TEXT NOT NULL CHECK (rol IN ('admin', 'socio', 'ventas', 'finanzas')),
  activo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. RLS — solo usuarios autenticados pueden leer su propio registro
ALTER TABLE disabi_usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario_lee_su_propio_registro"
  ON disabi_usuarios FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "admin_lee_todos"
  ON disabi_usuarios FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM disabi_usuarios u
      WHERE u.user_id = auth.uid() AND u.rol = 'admin'
    )
  );

-- 3. Insertar los 6 usuarios
-- ⚠️  IMPORTANTE: Reemplaza los UUIDs de la columna user_id con los UUIDs
--     reales que aparecen en Supabase → Authentication → Users
--     después de crear cada usuario manualmente.
--
-- FORMATO: ir a Authentication → Users → clic en cada usuario → copiar su UUID

INSERT INTO disabi_usuarios (user_id, nombre, email, rol) VALUES
  ('00000000-0000-0000-0000-000000000001', 'José Roberto Chávez',  'joserobertochavezjuarez@outlook.com', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'Jennifer Vides',        'jvides04@gmail.com',                  'admin'),
  ('00000000-0000-0000-0000-000000000003', 'Carlos Boris Joya',     'bjoya19@gmail.com',                   'socio'),
  ('00000000-0000-0000-0000-000000000004', 'Mónica Ramos',          'monica.ramos@saboresideales.com',     'ventas'),
  ('00000000-0000-0000-0000-000000000005', 'Marcela Chacón',        'marcela.chacon@saboresideales.com',   'ventas'),
  ('00000000-0000-0000-0000-000000000006', 'Contador',              'contador@saboresideales.com',          'finanzas');

-- ══════════════════════════════════════════════════════════════════
-- INSTRUCCIONES PARA CREAR LOS 6 USUARIOS EN AUTH
-- ══════════════════════════════════════════════════════════════════
-- 1. Ir a Supabase Dashboard → proyecto ekalupbolumvwwscojjn
-- 2. Authentication → Users → "Add user" → "Create new user"
-- 3. Crear uno por uno con email + contraseña temporal:
--
--    joserobertochavezjuarez@outlook.com  → contraseña temporal de tu elección
--    jvides04@gmail.com
--    bjoya19@gmail.com
--    monica.ramos@saboresideales.com
--    marcela.chacon@saboresideales.com
--    contador@saboresideales.com
--
-- 4. Después de crearlos, copiar el UUID de cada uno y reemplazar
--    los '00000000-...' del INSERT de arriba, luego ejecutar el INSERT.
-- ══════════════════════════════════════════════════════════════════

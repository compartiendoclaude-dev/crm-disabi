-- ============================================================================
-- DISABI ERP — Contabilidad Fase 5
--   (a) Activos Fijos: subledger + depreciación mensual automática
--   (b) Hardening de RLS: cierra el acceso directo por API/REST a las tablas
--       del libro contable — todo pasa a estar detrás de dos funciones
--       SECURITY DEFINER (disabi_crear_asiento / disabi_borrar_asientos_por_
--       origen), y las tablas "solo tú capturas" (asientos manuales, cierres
--       de ejercicio, apertura, activos fijos) exigen rol admin/finanzas
--       para escribir, no solo "cualquier usuario autenticado".
--
-- ORDEN DE DESPLIEGUE — IMPORTANTE:
--   1) Despliega primero el TAR de la app (el código ya usa
--      disabi_borrar_asientos_por_origen en vez de un DELETE directo).
--   2) Corre este script completo, de una sola vez, en el SQL Editor de
--      Supabase (proyecto ekalupbolumvwwscojjn).
--   Si corres el script ANTES de desplegar la app nueva, el código viejo
--   (que borra la tabla directo) va a fallar hasta que despliegues el TAR —
--   nada se corrompe, pero botones de "eliminar" van a dar error mientras
--   tanto.
-- ============================================================================


-- ── 1) ACTIVOS FIJOS ─────────────────────────────────────────────────────
-- Subledger real: cada activo con su costo, valor residual y vida útil.
-- disabi_depreciacion_devengos guarda, por activo y por período (YYYY-MM),
-- la cuota ya calculada y contabilizada — es lo que Libro Mayor / Balance
-- General / Estado de Resultados terminan leyendo (vía el asiento que
-- generan_devengo_depreciacion postea normalmente contra 6205/1202).

CREATE TABLE IF NOT EXISTS disabi_activos_fijos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             text NOT NULL,
  fecha_adquisicion  date NOT NULL,
  costo              numeric(14,2) NOT NULL CHECK (costo > 0),
  valor_residual     numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_residual >= 0),
  vida_util_meses    int NOT NULL CHECK (vida_util_meses > 0),
  activo             boolean NOT NULL DEFAULT true,
  fecha_baja         date,
  notas              text,
  creado_por         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (valor_residual < costo)
);

CREATE TABLE IF NOT EXISTS disabi_depreciacion_devengos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activo_fijo_id  uuid NOT NULL REFERENCES disabi_activos_fijos(id),
  periodo         text NOT NULL, -- 'YYYY-MM'
  monto           numeric(14,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activo_fijo_id, periodo)
);

ALTER TABLE disabi_activos_fijos ENABLE ROW LEVEL SECURITY;
ALTER TABLE disabi_depreciacion_devengos ENABLE ROW LEVEL SECURITY;


-- ── 2) HELPER: rol del usuario autenticado actual ───────────────────────
-- Reutiliza disabi_usuarios (ya tiene su propia RLS: "usuario lee su propio
-- rol"), así que puede ser SECURITY INVOKER — no necesita saltarse RLS,
-- solo lee la fila del propio usuario.

CREATE OR REPLACE FUNCTION disabi_rol_actual()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT rol FROM disabi_usuarios WHERE user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION disabi_rol_actual() TO authenticated;


-- ── 3) RLS de las tablas nuevas ──────────────────────────────────────────
-- Mismo criterio que PERMISOS.contabilidad en lib/constants.ts: admin y
-- finanzas pueden escribir; cualquier autenticado puede leer (el API ya
-- filtra por permiso de lectura antes de llegar aquí).

CREATE POLICY disabi_activos_fijos_select ON disabi_activos_fijos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disabi_activos_fijos_write ON disabi_activos_fijos
  FOR ALL TO authenticated
  USING (disabi_rol_actual() IN ('admin','finanzas'))
  WITH CHECK (disabi_rol_actual() IN ('admin','finanzas'));

CREATE POLICY disabi_depreciacion_devengos_select ON disabi_depreciacion_devengos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disabi_depreciacion_devengos_write ON disabi_depreciacion_devengos
  FOR ALL TO authenticated
  USING (disabi_rol_actual() IN ('admin','finanzas'))
  WITH CHECK (disabi_rol_actual() IN ('admin','finanzas'));


-- ── 4) Mismo hardening para las tablas de Fase 3/4 que quedaron con
--      USING(true) — sustituye sus políticas permisivas por una que exige
--      admin/finanzas para escribir (la lectura se queda abierta). ───────

DROP POLICY IF EXISTS disabi_asientos_manuales_auth ON disabi_asientos_manuales;
CREATE POLICY disabi_asientos_manuales_select ON disabi_asientos_manuales
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disabi_asientos_manuales_write ON disabi_asientos_manuales
  FOR ALL TO authenticated
  USING (disabi_rol_actual() IN ('admin','finanzas'))
  WITH CHECK (disabi_rol_actual() IN ('admin','finanzas'));

DROP POLICY IF EXISTS disabi_cierres_ejercicio_auth ON disabi_cierres_ejercicio;
CREATE POLICY disabi_cierres_ejercicio_select ON disabi_cierres_ejercicio
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disabi_cierres_ejercicio_write ON disabi_cierres_ejercicio
  FOR ALL TO authenticated
  USING (disabi_rol_actual() IN ('admin','finanzas'))
  WITH CHECK (disabi_rol_actual() IN ('admin','finanzas'));

DROP POLICY IF EXISTS disabi_apertura_contable_auth ON disabi_apertura_contable;
CREATE POLICY disabi_apertura_contable_select ON disabi_apertura_contable
  FOR SELECT TO authenticated USING (true);
CREATE POLICY disabi_apertura_contable_write ON disabi_apertura_contable
  FOR ALL TO authenticated
  USING (disabi_rol_actual() IN ('admin','finanzas'))
  WITH CHECK (disabi_rol_actual() IN ('admin','finanzas'));


-- ── 5) Núcleo del libro (disabi_asientos_contables, disabi_partidas):
--      NADIE escribe la tabla directo desde la app — nunca lo hicieron a
--      propósito, siempre pasó por disabi_crear_asiento y por un DELETE
--      filtrado por origen_tabla/origen_id. El problema es que ese DELETE
--      era un DELETE de tabla normal, alcanzable también desde fuera de la
--      app con la misma sesión — así que se reemplaza por una función
--      dedicada, y se le quita a `authenticated` el permiso de escribir la
--      tabla directo. Cualquier rol autenticado SIGUE pudiendo crear/borrar
--      asientos (su propia venta, gasto, planilla, etc. lo necesita) — pero
--      solo a través de estas dos funciones. ──────────────────────────────

CREATE OR REPLACE FUNCTION disabi_crear_asiento(
  p_fecha date, p_concepto text, p_origen_tabla text, p_origen_id uuid,
  p_lineas jsonb, p_creado_por uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_asiento_id uuid;
BEGIN
  INSERT INTO disabi_asientos_contables (fecha, periodo, concepto, origen_tabla, origen_id, creado_por)
  VALUES (p_fecha, to_char(p_fecha,'YYYY-MM'), p_concepto, p_origen_tabla, p_origen_id, p_creado_por)
  RETURNING id INTO v_asiento_id;

  INSERT INTO disabi_partidas (asiento_id, cuenta_codigo, debe, haber, descripcion)
  SELECT v_asiento_id, linea->>'cuenta_codigo', COALESCE((linea->>'debe')::numeric,0),
         COALESCE((linea->>'haber')::numeric,0), linea->>'descripcion'
  FROM jsonb_array_elements(p_lineas) AS linea;

  RETURN v_asiento_id;
END; $$;

GRANT EXECUTE ON FUNCTION disabi_crear_asiento(date, text, text, uuid, jsonb, uuid) TO authenticated;

-- Nueva: reemplaza el DELETE directo (borrarAsientoDeOrigen /
-- borrarAsientosPorOrigenes en lib/contabilidad-server.ts). Acepta un
-- arreglo de origen_id para cubrir también los borrados en lote (ej. todos
-- los abonos de una CxC que se elimina).
CREATE OR REPLACE FUNCTION disabi_borrar_asientos_por_origen(p_origen_tabla text, p_origen_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM disabi_asientos_contables
  WHERE origen_tabla = p_origen_tabla AND origen_id = ANY(p_origen_ids)
$$;

GRANT EXECUTE ON FUNCTION disabi_borrar_asientos_por_origen(text, uuid[]) TO authenticated;


-- ── 6) Plan de cuentas: catálogo de solo lectura desde la app (no hay
--      pantalla que lo edite — se mantiene por migración). ───────────────

DROP POLICY IF EXISTS disabi_plan_cuentas_auth ON disabi_plan_cuentas;
CREATE POLICY disabi_plan_cuentas_select ON disabi_plan_cuentas
  FOR SELECT TO authenticated USING (true);


-- ── 7) Cierra el acceso directo a la tabla — CORRE ESTO AL FINAL, con el
--      TAR de la app ya desplegado (paso 1 de arriba). A partir de aquí,
--      la ÚNICA forma de escribir disabi_asientos_contables / disabi_
--      partidas / disabi_plan_cuentas es a través de las funciones
--      SECURITY DEFINER de arriba. ─────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON disabi_asientos_contables FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON disabi_partidas            FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON disabi_plan_cuentas         FROM authenticated;

-- Las políticas "_auth" originales de estas 3 tablas (FOR ALL USING(true))
-- se quedan como están — ya no importan para escritura porque el REVOKE de
-- arriba actúa primero (sin el GRANT, RLS ni siquiera se evalúa), y siguen
-- sirviendo para el SELECT que todos los reportes necesitan.

-- ============================================================================
-- Verificación rápida después de correrlo:
--   select disabi_rol_actual();                        -- debe devolver tu rol
--   select * from disabi_asientos_manuales limit 1;     -- debe funcionar (lectura)
--   insert into disabi_plan_cuentas (codigo, nombre, tipo, naturaleza, nivel, es_imputable)
--     values ('9999','test','Activo','Deudora',4,true); -- debe fallar (permission denied)
-- ============================================================================

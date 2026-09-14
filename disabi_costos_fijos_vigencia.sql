-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Vigencia por fecha para Costos Fijos
-- ══════════════════════════════════════════════════════════════════
-- Problema que resuelve: hasta ahora, el Estado de Resultados sumaba
-- TODOS los costos fijos activos sin importar el mes que se estuviera
-- viendo. Si hoy subes el alquiler de $500 a $600, ese cambio se
-- aplicaba retroactivamente a los meses pasados también.
--
-- Con este cambio, cada costo fijo tiene una vigencia (vigente_desde /
-- vigente_hasta). Cuando la app detecta que cambiaste el monto de un
-- costo fijo, cierra la versión anterior (vigente_hasta) y crea una
-- versión nueva (vigente_desde = hoy) en vez de sobrescribir el monto
-- en el mismo registro. Así marzo sigue calculando con $500 y abril en
-- adelante con $600. Lo mismo aplica si desactivas un costo fijo
-- porque ya no aplica: se cierra su vigencia en vez de desaparecer de
-- todos los meses históricos.
--
-- Ejecutar una sola vez. Es idempotente (se puede correr varias veces
-- sin duplicar columnas ni dañar datos).
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE disabi_costos_fijos ADD COLUMN IF NOT EXISTS vigente_desde DATE;
ALTER TABLE disabi_costos_fijos ADD COLUMN IF NOT EXISTS vigente_hasta DATE;

-- Backfill: los registros que ya existían se consideran vigentes desde
-- que fueron creados (created_at). Si no tienen created_at, se asume
-- el 1 de enero de 2024 como fecha conservadora de inicio.
UPDATE disabi_costos_fijos
SET vigente_desde = COALESCE(created_at::date, '2024-01-01')
WHERE vigente_desde IS NULL;

ALTER TABLE disabi_costos_fijos ALTER COLUMN vigente_desde SET DEFAULT CURRENT_DATE;
ALTER TABLE disabi_costos_fijos ALTER COLUMN vigente_desde SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_costos_fijos_vigencia
  ON disabi_costos_fijos (vigente_desde, vigente_hasta);

-- Verificación rápida (opcional, solo lectura):
-- SELECT descripcion, monto, activo, vigente_desde, vigente_hasta
-- FROM disabi_costos_fijos ORDER BY descripcion, vigente_desde;

-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Restricción UNIQUE en disabi_cxc.venta_id
-- ══════════════════════════════════════════════════════════════════
-- Hallazgo (evaluación de CxC, Sep-2026): disabi_cxc.venta_id vincula
-- cada Cuenta por Cobrar con la venta a crédito que la originó (ver
-- disabi_cxc_venta_link.sql), pero nada en la base de datos impedía
-- que dos CxC quedaran apuntando a la MISMA venta. Si eso llegara a
-- pasar (por un bug futuro, una carrera de escritura, o una corrida
-- manual de SQL), el código que sincroniza la CxC al editar una venta
-- (app/api/ventas/route.ts, action=save_venta con editId) usa
-- .eq('venta_id', editId) esperando una sola fila — con dos filas
-- duplicadas, la sincronización quedaría ambigua o solo tocaría una
-- de las dos, dejando a la otra con datos obsoletos sin que nadie lo
-- note. La restricción UNIQUE convierte esa suposición del código en
-- una garantía real de la base de datos.
--
-- venta_id es nullable (CxC no vinculadas a una venta específica, o
-- CxC cuya venta fue eliminada, quedan con venta_id NULL) — en
-- Postgres una restricción UNIQUE permite múltiples NULL sin
-- conflicto, así que esto NO afecta esos casos.
--
-- Ejecutar una sola vez. Idempotente (usa un bloque DO que verifica
-- si la restricción ya existe antes de crearla).
-- ══════════════════════════════════════════════════════════════════

-- PASO 1 — Verificación previa (solo lectura, ejecutar primero):
-- Si esta consulta devuelve alguna fila, hay ventas con más de una CxC
-- vinculada y hay que resolverlo a mano ANTES de aplicar la restricción
-- (el PASO 2 fallará con un error claro si se salta este paso y existen
-- duplicados, así que no hay riesgo de dejar el sistema en mal estado).
--
-- SELECT venta_id, COUNT(*) AS num_cxc
-- FROM disabi_cxc
-- WHERE venta_id IS NOT NULL
-- GROUP BY venta_id
-- HAVING COUNT(*) > 1;

-- PASO 2 — Aplicar la restricción:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'disabi_cxc_venta_id_unique'
  ) THEN
    ALTER TABLE disabi_cxc
      ADD CONSTRAINT disabi_cxc_venta_id_unique UNIQUE (venta_id);
  END IF;
END $$;

-- Verificación (opcional, solo lectura):
-- SELECT conname, contype FROM pg_constraint WHERE conname = 'disabi_cxc_venta_id_unique';

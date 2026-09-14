-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Limpieza: gastos duplicados de importaciones ya recibidas
-- ══════════════════════════════════════════════════════════════════
-- Contexto: antes del fix de hoy, al recibir una importación con la opción
-- "generar gasto" activada, el sistema creaba UN REGISTRO EN disabi_gastos
-- (categoría "Compra Importación") ADEMÁS del registro en disabi_compras.
-- Ahora el Costo de Ventas se calcula directo desde disabi_compras
-- (importaciones con estado='Recibido'), así que esos gastos ya existentes
-- quedan contados DOS VECES en el Estado de Resultados.
--
-- Verificado con lectura en vivo (solo SELECT, ningún cambio hecho): estos
-- son los ÚNICOS 3 registros de disabi_gastos que hacen eco de una
-- importación ya contada como Costo de Ventas. Cada uno fue confirmado
-- 1:1 contra su importación correspondiente en disabi_compras por monto:
--
--   id 0e8208cc-495d-479a-8024-75dc7df14f74  $8,040.00   fecha 2026-09-01
--   id 151660c7-d823-424f-9483-10315feb56b7  $7,742.50   fecha 2026-07-01
--   id 3db732d4-72f0-45ee-9a1e-eaadadd9da9f  $3,570.00   fecha 2026-06-01
--
-- Meses afectados mientras estos 3 registros sigan en disabi_gastos:
-- Jun, Jul y Sep 2026 — el Costo de Ventas de esos meses está inflado
-- (doble contado) hasta que se borren.
--
-- ══════════════════════════════════════════════════════════════════
-- Paso 1 — Confirmar (solo lectura) que siguen siendo los mismos 3 antes
-- de borrar — por si se editó/borró algo manualmente desde que se revisó:
-- ══════════════════════════════════════════════════════════════════

SELECT id, fecha, descripcion, monto, categoria, tipo_egreso, proveedor
FROM disabi_gastos
WHERE id IN (
  '0e8208cc-495d-479a-8024-75dc7df14f74',
  '151660c7-d823-424f-9483-10315feb56b7',
  '3db732d4-72f0-45ee-9a1e-eaadadd9da9f'
)
ORDER BY fecha DESC;

-- ══════════════════════════════════════════════════════════════════
-- Paso 2 — Si el SELECT de arriba muestra los mismos 3 montos/fechas,
-- bórralos (borrado puntual por ID, no un DELETE amplio por categoría —
-- así no se toca ningún gasto real que no sea eco de importación):
-- ══════════════════════════════════════════════════════════════════

DELETE FROM disabi_gastos
WHERE id IN (
  '0e8208cc-495d-479a-8024-75dc7df14f74',
  '151660c7-d823-424f-9483-10315feb56b7',
  '3db732d4-72f0-45ee-9a1e-eaadadd9da9f'
);

-- Nota: ningún mes de estos 3 está cerrado todavía en Cierre Mensual (se
-- verificó también), así que este borrado no choca con ningún candado.
-- Ninguna venta, DTE, cliente, cotización ni otro dato se ve afectado —
-- este script solo toca estos 3 registros puntuales de disabi_gastos.

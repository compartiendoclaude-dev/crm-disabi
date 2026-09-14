-- ============================================================================
-- DISABI ERP — Comisiones Fase 2
--   Corrige el bug de fondo: el cálculo de comisiones comparaba
--   disabi_productos.categoria (taxonomía de Inventario: Sabores / Otro /
--   Insumo / Licencias) contra las categorías del Excel maestro de
--   comisiones (Saborizantes / Salsas / Cafe / etc.) — nunca coincidían, así
--   que ninguna venta encontraba su tramo y la comisión calculada siempre
--   fue $0, sin importar cuánto se vendiera.
--
--   Esta migración agrega una categoría de comisión PROPIA por producto
--   (categoria_comision), separada de la categoría de Inventario, backfillea
--   los productos existentes con el mapeo que se puede inferir con
--   confianza, y agrega al catálogo de rangos las categorías nuevas de tu
--   Excel de septiembre 2026 (Matcha, Bases de frappe, Artículos de Bar,
--   Tazas) — esas no tienen un precio de tabla fijo en el Excel (la celda
--   de precio siempre está vacía en los 9 meses), así que se marcan con
--   usar_precio_real = true: el sistema usa el precio real de cada venta en
--   vez de un promedio inventado.
--
-- ORDEN DE DESPLIEGUE:
--   1) Despliega primero el TAR de la app (el código ya espera
--      categoria_comision y la columna usar_precio_real).
--   2) Corre este script completo, de una sola vez, en el SQL Editor de
--      Supabase (proyecto ekalupbolumvwwscojjn).
-- ============================================================================


-- ── 1) Columna nueva en productos ────────────────────────────────────────
ALTER TABLE disabi_productos
  ADD COLUMN IF NOT EXISTS categoria_comision TEXT;


-- ── 2) Backfill — productos que se pueden mapear con confianza ──────────
-- Los 52 productos de la categoría de Inventario "Sabores" son, sin
-- excepción, los frascos de saborizante individuales (Almendra, Amaretto,
-- Blueberry, Vainilla, etc.) → todos son "Saborizantes" en el Excel.
UPDATE disabi_productos SET categoria_comision = 'Saborizantes'
  WHERE categoria = 'Sabores';

-- El resto se mapea producto por producto (por id, no por nombre, para no
-- depender de acentos/mayúsculas exactas).
UPDATE disabi_productos SET categoria_comision = 'Cafe'
  WHERE id = '13ef2aca-34a2-43df-8743-0edc1991b81a';              -- Café

UPDATE disabi_productos SET categoria_comision = 'Salsas'
  WHERE id = 'e4dc109e-2f3f-4e99-b3dc-78ef635854dc';               -- Salsa Caramelo Salado
UPDATE disabi_productos SET categoria_comision = 'Salsas'
  WHERE id = '256fe829-01a1-4755-af4b-7f3d8a8ac355';               -- Salsa Caramelo
UPDATE disabi_productos SET categoria_comision = 'Salsas'
  WHERE id = '0ad74b13-92fa-49ec-a373-0bed8460d36d';               -- Salsa Chocolate
UPDATE disabi_productos SET categoria_comision = 'Salsas'
  WHERE id = 'ce072cc4-fcea-4f76-ad96-947cfb5fa22f';               -- Salsa Chocolate Blanco

UPDATE disabi_productos SET categoria_comision = 'Base de frappe Chai'
  WHERE id = '360d97fb-f4e6-41e0-b235-71853e9d5746';               -- Base de Chaí
UPDATE disabi_productos SET categoria_comision = 'Base de frappe Chocolate'
  WHERE id = '15c15f8a-93e1-4ac2-8d42-a1092c4c2d7a';               -- Base de Chocolate
UPDATE disabi_productos SET categoria_comision = 'Base de frappe Vainilla'
  WHERE id = 'ec0a75ab-19b2-434f-bad8-3b69ea1d2612';               -- Base de Vainilla

UPDATE disabi_productos SET categoria_comision = 'Dispensadores Salsas'
  WHERE id = '856fd5d9-814e-422f-b447-07950c6bdf52';               -- Dispensador de Salsa

-- Estos 4 quedan SIN asignar a propósito — no calzan con ninguna categoría
-- del Excel sin adivinar, y adivinar mal en un cálculo de dinero real es
-- peor que dejarlos en $0 hasta que los revises tú mismo en Inventario
-- (columna nueva "Cat. Comisión", con badge ámbar "Sin asignar"):
--   · Base de Matcha   (¿es una 4ta base de frappe, o insumo para las dos
--                        categorías de Matcha que sí tienen precio propio?)
--   · DISPENSADORES    (genérico — ¿dispensador de saborizante o duplicado
--                        de "Dispensador de Salsa"?)
--   · Pistacho         (¿saborizante o salsa?)
--   · Popping Boba     (no aparece en ninguna categoría del Excel)


-- ── 3) Columna nueva en la tabla de rangos: usar precio real de venta ───
ALTER TABLE disabi_comision_rangos
  ADD COLUMN IF NOT EXISTS usar_precio_real BOOLEAN NOT NULL DEFAULT false;


-- ── 4) Categorías nuevas del Excel de septiembre 2026 — sin tramos de
--      precio (usar_precio_real = true: se usa precio_unitario/1.13 de
--      cada venta, no un promedio fijo). Nota: Matcha puro Barista, Matcha
--      Ceremonial The Coffee, Articulos de Bar y Tazas todavía NO existen
--      como productos en tu catálogo — tendrás que crearlos en Inventario
--      (con esta categoría de comisión) antes de que puedan venderse y
--      comisionarse. ──────────────────────────────────────────────────────
INSERT INTO disabi_comision_rangos
  (categoria, precio_iva_desc, precio_min_iva, precio_max_iva, precio_sin_iva, pct_comision, orden, usar_precio_real)
VALUES
  ('Matcha puro Barista',          'Precio real de cada venta', NULL, NULL, 39.814159, 0.04, 1, true),
  ('Matcha Ceremonial The Coffee', 'Precio real de cada venta', NULL, NULL, 203.530973, 0.05, 1, true),
  ('Base de frappe Chai',          'Precio real de cada venta', NULL, NULL, 20.991150, 0.02, 1, true),
  ('Base de frappe Vainilla',      'Precio real de cada venta', NULL, NULL, 0, 0.02, 1, true),
  ('Base de frappe Chocolate',     'Precio real de cada venta', NULL, NULL, 0, 0.02, 1, true),
  ('Articulos de Bar',             'Precio real de cada venta', NULL, NULL, 0, 0.04, 1, true),
  ('Tazas',                        'Precio real de cada venta', NULL, NULL, 0, 0.04, 1, true)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- Verificación rápida después de correrlo:
--   select categoria_comision, count(*) from disabi_productos
--     group by categoria_comision order by categoria_comision;
--     -- Saborizantes debe tener 52; deben aparecer 4 filas en NULL
--   select categoria, usar_precio_real, count(*) from disabi_comision_rangos
--     group by categoria, usar_precio_real order by categoria;
-- ============================================================================

-- ══════════════════════════════════════════════════════════════════
-- DISABI ERP — Vincular CxC con la venta que la origina
-- ══════════════════════════════════════════════════════════════════
-- Hallazgo: una venta a crédito creaba un "Pendiente de Pago" en la
-- tabla de Cotizaciones, pero NUNCA creaba una Cuenta por Cobrar real
-- en disabi_cxc — eran dos sistemas de cartera paralelos que no se
-- hablaban. Además, al marcar ese Pendiente de Pago como pagado, o al
-- procesar una devolución con nota de crédito, el código intentaba
-- actualizar columnas de disabi_cxc que ya no existen (saldo, monto,
-- numero, fecha_emision) — quedaban rotos en silencio.
--
-- Esta columna permite que, de ahora en adelante, cada venta a crédito
-- cree su propia CxC vinculada directamente por id (no por coincidencia
-- de nombre de cliente y monto, que es frágil), y que pagar esa venta o
-- devolverla actualice exactamente la CxC correcta.
--
-- Ejecutar una sola vez. Idempotente.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE disabi_cxc ADD COLUMN IF NOT EXISTS venta_id UUID REFERENCES disabi_ventas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cxc_venta ON disabi_cxc(venta_id);

-- Verificación (opcional, solo lectura):
-- SELECT id, cliente, monto_total, monto_pendiente, estado, venta_id
-- FROM disabi_cxc ORDER BY created_at DESC LIMIT 20;

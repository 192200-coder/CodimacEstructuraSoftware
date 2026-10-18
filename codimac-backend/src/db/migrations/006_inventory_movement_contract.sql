ALTER TABLE inventory_movements
  DROP CONSTRAINT inventory_movements_movement_type_check,
  DROP CONSTRAINT IF EXISTS inventory_adjustment_reason_check,
  DROP CONSTRAINT IF EXISTS inventory_adjustment_detail_check;

ALTER TABLE inventory_movements
  RENAME COLUMN product_id TO producto_id;
ALTER TABLE inventory_movements
  RENAME COLUMN movement_type TO tipo;
ALTER TABLE inventory_movements
  RENAME COLUMN quantity TO cantidad;
ALTER TABLE inventory_movements
  RENAME COLUMN actor_id TO usuario_id;
ALTER TABLE inventory_movements
  RENAME COLUMN created_at TO fecha_hora;
ALTER TABLE inventory_movements
  RENAME COLUMN reason TO motivo;
ALTER TABLE inventory_movements
  RENAME COLUMN detail TO detalle;

UPDATE inventory_movements
SET tipo = CASE tipo
  WHEN 'Entrada' THEN 'ENTRADA'
  WHEN 'Ajuste' THEN 'AJUSTE'
  WHEN 'Reserva' THEN 'RESERVA'
  WHEN 'Liberación' THEN 'LIBERACION'
  ELSE tipo
END;

ALTER TABLE inventory_movements
  ADD COLUMN pedido_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  ADD CONSTRAINT inventory_movements_tipo_check
    CHECK (tipo IN ('ENTRADA', 'AJUSTE', 'RESERVA', 'LIBERACION', 'SALIDA')),
  ADD CONSTRAINT inventory_adjustment_reason_check
    CHECK (tipo <> 'AJUSTE' OR (motivo IS NOT NULL AND motivo IN (
      'Conteo físico', 'Merma o daño', 'Corrección de registro', 'Otro'
    ))),
  ADD CONSTRAINT inventory_adjustment_detail_check
    CHECK (
      tipo <> 'AJUSTE'
      OR (
        (motivo = 'Otro' AND detalle IS NOT NULL AND length(btrim(detalle)) BETWEEN 5 AND 120)
        OR (motivo <> 'Otro' AND detalle IS NULL)
      )
    );

CREATE INDEX inventory_movements_product_history_idx
  ON inventory_movements(producto_id, fecha_hora DESC, id DESC);

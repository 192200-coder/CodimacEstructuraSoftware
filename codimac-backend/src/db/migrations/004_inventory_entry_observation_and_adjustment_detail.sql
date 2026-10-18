ALTER TABLE inventory_movements
  ADD COLUMN observation text,
  ADD COLUMN detail text;

ALTER TABLE inventory_movements
  ALTER COLUMN reason DROP NOT NULL;

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_adjustment_reason_check
    CHECK (
      movement_type <> 'Ajuste'
      OR (reason IS NOT NULL AND reason IN ('Conteo físico', 'Merma o daño', 'Corrección de registro', 'Otro'))
    ) NOT VALID,
  ADD CONSTRAINT inventory_adjustment_detail_check
    CHECK (
      movement_type <> 'Ajuste'
      OR (
        (reason = 'Otro' AND detail IS NOT NULL AND length(btrim(detail)) BETWEEN 5 AND 120)
        OR (reason <> 'Otro' AND detail IS NULL)
      )
    ) NOT VALID;

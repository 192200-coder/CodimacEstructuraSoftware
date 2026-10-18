ALTER TABLE orders RENAME COLUMN code TO codigo;
ALTER TABLE routes RENAME COLUMN code TO codigo;

CREATE SEQUENCE order_code_seq AS bigint;
CREATE SEQUENCE route_code_seq AS bigint;

WITH numbered_orders AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS sequence_number
  FROM orders
)
UPDATE orders AS o
SET codigo = 'PED-' || lpad(
  numbered_orders.sequence_number::text,
  GREATEST(4, length(numbered_orders.sequence_number::text)),
  '0'
)
FROM numbered_orders
WHERE o.id = numbered_orders.id;

WITH numbered_routes AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS sequence_number
  FROM routes
)
UPDATE routes AS r
SET codigo = 'R-' || lpad(
  numbered_routes.sequence_number::text,
  GREATEST(3, length(numbered_routes.sequence_number::text)),
  '0'
)
FROM numbered_routes
WHERE r.id = numbered_routes.id;

SELECT setval(
  'order_code_seq',
  GREATEST(COALESCE((SELECT count(*) FROM orders), 0), 1),
  EXISTS (SELECT 1 FROM orders)
);

SELECT setval(
  'route_code_seq',
  GREATEST(COALESCE((SELECT count(*) FROM routes), 0), 1),
  EXISTS (SELECT 1 FROM routes)
);

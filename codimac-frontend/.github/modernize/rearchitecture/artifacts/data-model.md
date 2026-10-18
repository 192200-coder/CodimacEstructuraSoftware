# Existing data model

The current PostgreSQL schema is defined in `../../../../../codimac-backend/src/db/migrations/001_codimac.sql`. This inventory was originally extracted from the Supabase SQL; the current schema replaces the Supabase `auth.users` dependency with email, bcrypt password hash, and role fields in `profiles`. See the migration for the authoritative constraints and relations.

## Status values

The new schema uses `CHECK` constraints (not PostgreSQL enum types) for these
values:

- `codimac_role`: Despachador, Chofer, Administrador.
- `order_status`: Pendiente, En preparación, Listo, En ruta, Entregado, Cancelado.
- `stop_status`: Pendiente, En camino, Entregada, Incidencia, No entregada.
- `route_status`: Borrador, Aprobada, Asignada, En ruta, Cerrada.

## Entities and relationships

- `profiles`: email, bcrypt password hash, display name, role, active flag, creation time. Referenced by orders, routes, inventory movements, incidents, status events, global parameters, preferences, and audit events.
- `clients`: name, contact, address, latitude/longitude, created/updated timestamps. One client can have many orders.
- `products`: unique name, unit, weight in kg, total/reserved stock, active flag, timestamps. Referenced by order items, reservations, and inventory movements; reserved stock is constrained to `[0, total_stock]`.
- `orders`: unique code and tracking token; belongs to a client and creator profile; status, ordered/deadline times, optional active route, timestamps.
- `order_items`: join table between orders and products; quantity > 0; composite primary key `(order_id, product_id)`.
- `stock_reservations`: order/product reservation quantities and release timestamp; unique `(order_id, product_id)`.
- `inventory_movements`: product, movement type, quantity, reason, actor, creation time. Allowed movement types are Entrada, Ajuste, Reserva, Liberación.
- `vehicles`: unique plate, type, positive load capacity, average speed and fuel efficiency, availability, creation time.
- `routes`: unique code, status, optional driver/vehicle, distance, estimated minutes/liters/cost, real-traffic flag, start/close times, creator, timestamps.
- `route_stops`: belongs to route and order; sequence, stop status, ETA, delivery time, receiver, attempts (0–2); unique order and sequence within a route.
- `incidents`: belongs to a route stop; cause (Cliente ausente, Dirección errónea, Otra), notes, opening actor/time, optional close time.
- `status_events`: entity type/id, previous/new status, actor, optional route/stop references, creation time; used for audit history.
- `global_parameters`: singleton warehouse coordinates, fuel price, minutes per stop, updating profile and timestamp.
- `user_preferences`: one row per profile, selected role and active section.
- `audit_events`: user-generated audit message, actor and creation time.

## Key entities

- **Pedido (`orders`)** — customer request with status lifecycle and public tracking token.
- **Detalle de pedido (`order_items`)** — requested products and quantities for an order.
- **Producto (`products`)** — catalog item with inventory and reservation totals.
- **Reserva de stock (`stock_reservations`)** — quantity held for an order until release.
- **Reparto (`routes`)** — approved, assigned, started, and closed delivery route.
- **Parada (`route_stops`)** — ordered delivery attempt for one order within a route.
- **Cliente (`clients`)** — destination, contact, and coordinates.
- **Vehículo (`vehicles`)** — route capacity, speed, fuel-efficiency, and availability.

## Transaction and integrity boundaries

The schema defines integrity constraints; transactional operations live in the
Express API under `../../../../../codimac-backend/src/modules/`. Backend writes
must retain transaction boundaries for stock reservations, order transitions,
stop delivery/incidents, and route closure.

# CODIMAC API

API REST independiente para Angular, construida con Express y PostgreSQL. Es
compatible con Neon: configura `DATABASE_URL` con la cadena de conexión pooled
del proyecto y deja `DATABASE_SSL=true`.

## Requisitos y puesta en marcha

1. Instala Node.js 20 o posterior y pnpm.
2. Copia `.env.example` a `.env` y completa `DATABASE_URL` y `JWT_SECRET`.
   `GOOGLE_MAPS_API_KEY` es opcional: si no se configura, el selector utiliza
   Leaflet y OpenStreetMap. La clave de Google Maps JavaScript se expone al
   navegador por diseño; restríngela en Google Cloud por HTTP referrer/dominio
   y por API habilitada.
   `JWT_SECRET` debe ser aleatorio y tener al menos 32 caracteres. No publiques
   `.env`.
3. Ejecuta `pnpm install`.
4. Aplica el esquema con `pnpm migrate`.
5. Opcionalmente crea usuarios y catálogos demostrativos con `pnpm seed`.
   Las contraseñas iniciales de demostración son `demostracion`; cámbialas en
   entornos compartidos.
6. Inicia con `pnpm dev`. La API escucha en `http://localhost:3000` y debe
   permanecer ejecutándose mientras uses el frontend.

En otra terminal, ve a `../codimac-frontend/`, ejecuta `pnpm install` una vez y
después `pnpm dev`. Angular corre en `http://localhost:8443`; su proxy reenvía
`/api` y `/health` al backend en el puerto 3000. Mantén ambos procesos abiertos.

La migración solo crea la estructura; nunca elimina ni reinicia datos. El seed
añade registros únicamente cuando faltan. No hay credenciales de Neon incluidas
en el proyecto.
Las contraseñas se almacenan con bcrypt; los JWT duran ocho horas y sus sesiones
se revocan en PostgreSQL al cerrar sesión. El servidor revalida el perfil y su
rol en cada solicitud privada.

## Usuarios de demostración

Contraseña de todas: `demostracion`. El detalle de cada cuenta y de los datos de
ejemplo está en el [README principal](../README.md#usuarios-de-demostración).

| Correo | Nombre | Rol |
|---|---|---|
| maria@codimac.pe | María Rojas | Despachador |
| jose@codimac.pe | José Ramírez | Administrador |
| laura@codimac.pe | Laura Mendoza | Administrador |
| carlos@codimac.pe | Carlos Quispe | Chofer |
| ana@codimac.pe | Ana Torres | Chofer |
| luis@codimac.pe | Luis Huamán | Chofer |

`pnpm seed` agrega lo que falte; `pnpm seed -- --reset` borra pedidos, repartos,
inventario y catálogos, recarga el ejemplo y devuelve las cuentas de ejemplo a
`demostracion`. `POST /api/admin/demo-data/reset` hace lo mismo solo si
`DEMO_RESET_ENABLED=true`.

## API

Todas las rutas (excepto salud, login y seguimiento público) usan
`Authorization: Bearer <token>`.

- `GET /health`
- `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/state`, `PUT /api/preferences`, `POST /api/events`
- `GET /api/notifications` returns recent order, route, and stop status events;
  dispatchers and administrators see operational events, while drivers see
  events from their own routes
- `GET/POST /api/orders`, `POST /api/orders/:id/prepare|ready|cancel`
- `GET /api/resources`, `GET /api/catalog/:resource`
- `POST/PUT /api/admin/catalog/:resource[/:id]`
- `PUT /api/admin/parameters`, `GET/POST/PUT /api/admin/users`
- `GET /api/admin/audit` lists immutable audit events (administrator only), with
  date, user, entity, action, and pagination filters
- `POST /api/inventory/:productId/movements`
- `GET /api/inventory/:productId/movements` lists the product's chronological
  inventory movements (dispatcher or administrator)
- `POST /api/routes/matrix` devuelve la matriz de distancias y tiempos del
  puerto ServicioMapas (Google Routes con `GOOGLE_ROUTES_API_KEY`, o el
  estimador local; si el proveedor falla se usa el local y `usaTraficoReal` es
  `false`)
- `DELETE /api/routes/:id/orders/:orderId` quita un pedido de una ruta
  `Calculada` o `Aprobada`, renumera las paradas y vuelve a estimarla
- `GET /api/drivers` y `PUT /api/drivers/:id/availability` gestionan la
  disponibilidad de choferes (Despachador y Administrador); un chofer no
  disponible no se puede asignar
- `POST /api/routes` creates a route in `Calculada`; `POST /api/routes/:id/approve`
  explicitly approves it before assignment
- `GET /api/routes/history` lists only closed operational routes for dispatchers
  and administrators; it reads routes, stops, drivers, and vehicles, never
  audit events or legacy generic messages
- `POST /api/routes/:id/assign|start`
- `DELETE /api/routes/:id` retires an unassigned calculated or approved route and releases its orders
- `POST /api/admin/demo-data` idempotently adds missing demo fixtures (administrator only)
- `GET /api/driver/route`
- `POST /api/stops/:id/deliver|incidents`
- `GET /api/admin/events`, `GET /api/orders/:id/events`
- `GET /api/indicators`, `POST /api/tracking`

Public tracking accepts `{ "codigo": "PED-0001", "ultimos4": "1234" }` in
the request body. The order code and the last four digits of the client's
registered contact number must match. Failed lookups return the same generic
message and are limited to five attempts per IP every ten minutes. Successful
responses contain only the queried order's status and, while it is in transit,
its stop position, route stop count, and ETA; personal details and other
orders' data are never returned.

Client records require a nine-digit mobile number beginning with `9`, a
5–150-character address, and map coordinates. The optional location reference
is limited to 150 characters. Administrators can configure the service-area
radius in route parameters; it defaults to 50 km and only triggers a warning
when a new client lies outside the radius.

Las escrituras de estado, stock, asignación, entrega e incidencia se ejecutan
en transacciones PostgreSQL. La autorización de rol se valida en el servidor;
no se confía en el rol o usuario enviado por el navegador.

La migración `006_inventory_movement_contract.sql` conserva
los movimientos existentes, normaliza sus tipos a `ENTRADA`, `AJUSTE`,
`RESERVA`, `LIBERACION` y `SALIDA`, y añade el vínculo opcional al pedido.
Entradas, ajustes, reservas, liberaciones y salidas quedan dentro de la misma
transacción que modifica el stock o completa la operación correspondiente.

Las rutas usan la máquina de estados `Calculada → Aprobada → Asignada →
En curso → Cerrada`. `POST /api/routes/:id/approve` registra la aprobación
explícita; un trigger PostgreSQL bloquea saltos de estado y cualquier
reactivación después del cierre. La ruta se cierra dentro de la transacción
que marca la última parada como `Entregada` o `No entregada`. Los dos intentos
de entrega se limitan por parada: tras el segundo fallo, el pedido vuelve a
`Listo` y conserva su reserva.

Los eventos de auditoría se registran desde los casos de uso y se escriben en la
misma transacción que la operación correspondiente. La migración
`003_immutable_audit.sql` protege `auditoria_eventos` contra `UPDATE` y `DELETE`
mediante un trigger. El endpoint `GET /api/admin/audit` es de solo lectura,
exclusivo para Administrador y admite filtros de fecha, usuario, entidad y
acción, además de paginación. Para ejecutar la prueba con PostgreSQL, configura
`AUDIT_TEST_DATABASE_URL` con una base de pruebas aislada; la prueba crea y
revierte un esquema temporal.

Las notificaciones de la interfaz son internas: el navegador consulta
`GET /api/notifications` cada 30 segundos y conserva localmente, por usuario,
qué eventos se marcaron como leídos. No se envían mensajes SMS ni WhatsApp.

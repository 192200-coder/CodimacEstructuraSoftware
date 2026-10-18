# CODIMAC API

API REST independiente para Angular, construida con Express y PostgreSQL. Es
compatible con Neon: configura `DATABASE_URL` con la cadena de conexión pooled
del proyecto y deja `DATABASE_SSL=true`.

## Requisitos y puesta en marcha

1. Instala Node.js 20 o posterior y pnpm.
2. Copia `.env.example` a `.env` y completa `DATABASE_URL` y `JWT_SECRET`.
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

| Correo | Rol | Contraseña inicial |
|---|---|---|
| maria@codimac.pe | Despachador | demostracion |
| carlos@codimac.pe | Chofer | demostracion |
| jose@codimac.pe | Administrador | demostracion |

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
- `POST /api/inventory/:productId/movements`
- `POST /api/routes` creates a route; when `driverId` and `vehicleId` are
  included, route creation and resource assignment are committed atomically
- `POST /api/routes/:id/assign|start`
- `DELETE /api/routes/:id` retires an unassigned approved route and releases its orders
- `POST /api/admin/demo-data` idempotently adds missing demo fixtures (administrator only)
- `GET /api/driver/route`
- `POST /api/stops/:id/deliver|incidents`
- `GET /api/admin/events`, `GET /api/orders/:id/events`
- `GET /api/indicators`, `GET /api/tracking/:token`

Public tracking uses the private UUID returned when the order is created, not
the visible order code. The authenticated dispatcher/admin orders list also
returns this UUID so it can be retrieved from the dashboard's recent-orders
table or the order detail panel and shared with the customer. Treat it as
private: anyone with the UUID can view that order's public tracking status.
After the configured delivery attempts are exhausted, tracking reports that
the delivery could not be completed and omits the stale route ETA.

Las escrituras de estado, stock, asignación, entrega e incidencia se ejecutan
en transacciones PostgreSQL. La autorización de rol se valida en el servidor;
no se confía en el rol o usuario enviado por el navegador.

Las notificaciones de la interfaz son internas: el navegador consulta
`GET /api/notifications` cada 30 segundos y conserva localmente, por usuario,
qué eventos se marcaron como leídos. No se envían mensajes SMS ni WhatsApp.

# Arquitectura de CODIMAC

## Estructura del espacio de trabajo

- `codimac-frontend/`: aplicación web Angular standalone.
- `codimac-backend/`: API REST Express + TypeScript y esquema PostgreSQL
  compatible con Neon.
- `src/dominio/`: reglas de pedidos, inventario, entregas y optimización,
  independientes del framework y del proveedor de base de datos.
- `codimac-backend/src/application/`: validaciones de casos de uso, incluida la
  disponibilidad de stock al registrar y preparar pedidos.
- `src/app/`: composición visual Angular por rol y área funcional.
- `codimac-backend/src/modules/`: endpoints REST separados por área.
- `codimac-backend/src/db/migrations/`: esquema relacional y restricciones.

## Base de datos y seguridad

Configura `DATABASE_URL` en `codimac-backend/.env` con la URL pooled de Neon.
El secreto JWT también vive exclusivamente en ese archivo. El backend guarda
hashes bcrypt, emite tokens JWT de ocho horas, registra y revoca sesiones en
PostgreSQL, vuelve a comprobar que el perfil siga activo en cada petición y
valida permisos por rol en el servidor.

La migración inicial modela perfiles, clientes, productos, pedidos, partidas,
reservas de existencias, movimientos, vehículos, rutas, paradas, incidencias,
eventos de estado y parámetros globales. También añade preferencias y eventos
de auditoría de usuario. No se usa autenticación ni SDK de Supabase.

Las operaciones de reserva/cancelación de stock, ajuste de inventario,
transición de pedido, creación/asignación/inicio de ruta, confirmación de
entrega e incidencia usan transacciones y bloqueos de fila PostgreSQL. El
backend aplica capacidad máxima, una ruta activa por chofer/vehículo, hasta diez
paradas y hasta dos intentos por entrega.

## Puesta en marcha

1. Configura `codimac-backend/.env` desde `.env.example`.
2. Desde `codimac-backend/`, ejecuta `pnpm install`, `pnpm migrate` y,
   opcionalmente, `pnpm seed`.
3. Inicia el backend con `pnpm dev` (puerto 3000).
4. Desde `codimac-frontend/`, inicia Angular con `pnpm dev` (puerto
   8443). El proxy del servidor de desarrollo reenvía `/api` y `/health` al
   backend.

Los despliegues del frontend deben servir `/api` y `/health` desde el backend
mediante un proxy inverso o ajustar el cliente HTTP. La migración es no
destructiva y no carga datos automáticamente; el comando seed es explícito.
El Administrador puede agregar desde la aplicación los registros demo que
falten; esta operación idempotente no elimina ni reemplaza datos.

## Integración de pantallas

El uso operativo requiere iniciar sesión. Pedidos, clientes, inventario,
recursos de reparto, usuarios, auditoría, indicadores y parámetros se leen
desde la API. Las mutaciones de pedidos, inventario, catálogos, asignación de
rutas y entregas también se guardan en PostgreSQL; sin sesión se muestra la
pantalla de acceso y no una operación local desconectada.

El planificador usa las coordenadas de los pedidos seleccionados, el vehículo
disponible y los parámetros guardados del almacén. Sus tiempos y costos son
estimaciones propias, no tráfico en tiempo real. El seguimiento público recibe
el token privado que se muestra al crear cada pedido; el código visible del
pedido no permite consultar datos de seguimiento.

# CODIMAC

### Tabla de Integrantes y Procesos E2E - CODIMAC v1.1

| Integrante | Proceso E2E | Inicio y Fin | Actores y Módulos Involucrados | Diagrama |
|---|---|---|---|---|
| **Maria Magdalena Villegas Huamani** | **1. Gestión de solicitudes de reparto** | **Inicio:** Cliente solicita pedido/registro.<br>**Fin:** Pedido en estado `Listo` con ubicación en mapa y stock reservado. | **Actores:** Cliente, Despachador.<br>**Módulos:** Angular (Clientes/Pedidos), API Express, Caso de Uso Pedidos, PostgreSQL. | [Ver Diagrama](./docs/diagramas/proceso-1-solicitudes.md) |
| **Maykol David Espinoza Kquerare** | **2. Planificación y optimización inteligente de rutas** | **Inicio:** Despachador selecciona pedidos en `Listo`.<br>**Fin:** Ruta generada en estado `Calculada` con orden óptimo, km, min, litros y costo (S/). | **Actores:** Despachador.<br>**Módulos:** Panel Repartos (Angular), Estimador Local (Routing Domain), API Express, PostgreSQL. | [Ver Diagrama](./docs/diagramas/proceso-2-planificacion.md) |
| **Gustavo Corahua Bravo** | **3. Gestión y asignación de conductores** | **Inicio:** Ruta en estado `Calculada`.<br>**Fin:** Ruta en estado `Asignada` con chofer y vehículo vinculados sin exceder peso en kg. | **Actores:** Despachador, Chofer.<br>**Módulos:** Repartos (Angular), API Resources/Routes, Caso de Uso Asignación, PostgreSQL. | [Ver Diagrama](./docs/diagramas/a.PNG) |
| **Carlos Daniel Huachallanqui Olivera** | **4. Ejecución y seguimiento de entregas** | **Inicio:** Chofer inicia ruta `Asignada` (pasa a `En curso`).<br>**Fin:** Cliente consulta tracking en portal de 5 pasos o chofer llega a parada. | **Actores:** Chofer, Cliente.<br>**Módulos:** Vista Móvil Chofer, Portal Público Tracking (Angular), API Public Tracking, PostgreSQL. | [Ver Diagrama](./docs/diagramas/proceso-4-ejecucion.md) |
| **Yaison Terry Huamani Carhuaricra** | **5. Control y cierre de repartos** | **Inicio:** Chofer atiende parada (entrega o incidencia).<br>**Fin:** Ruta en estado `Cerrada` con entregas x/N, km, min, stock descontado y auditoría registrada. | **Actores:** Chofer, Despachador.<br>**Módulos:** Vista Chofer, Historial Operativo, Auditoría (Angular), API Express, Casos de Uso, PostgreSQL. | [Ver Diagrama](./docs/diagramas/proceso-5-cierre.svg) |

Aplicación web de gestión logística para pedidos, inventario y reparto. El
espacio contiene una interfaz Angular y una API REST con Express y PostgreSQL.

## Requisitos

- Node.js 20.19 o posterior; para Angular 22, usa Node.js 20.19+, 22.12+ o
  24+. Se recomienda Node.js 22 LTS.
- **pnpm 10.34.3**, necesario para instalar las dependencias y ejecutar los
  scripts. Los proyectos usan `pnpm-lock.yaml`; no sustituyas pnpm por npm o
  yarn.
- Una base de datos PostgreSQL accesible desde el backend. También se puede
  usar una base compatible con Neon.

Si tu instalación de Node incluye Corepack, habilita pnpm con:

```powershell
corepack enable
corepack prepare pnpm@10.34.3 --activate
pnpm --version
```

## Instalación y configuración

1. Abre una terminal en `codimac-backend` e instala sus dependencias:

   ```powershell
   cd codimac-backend
   pnpm install
   Copy-Item .env.example .env
   ```

2. Edita `codimac-backend/.env` y configura:
   - `DATABASE_URL`: cadena de conexión de PostgreSQL.
   - `JWT_SECRET`: secreto aleatorio de al menos 32 caracteres.
   - `DATABASE_SSL=true` para conexiones que requieren TLS, por ejemplo Neon.
   - `CORS_ORIGIN=http://localhost:8443` para desarrollo local.

   No compartas ni confirmes el archivo `.env`; contiene credenciales locales.

3. Crea el esquema y, opcionalmente, los datos de demostración:

   ```powershell
   pnpm migrate
   pnpm seed
   ```

   La migración crea la estructura necesaria. El seed de demostración es
   opcional y agrega fixtures faltantes; no lo ejecutes contra una base con
   información real sin revisar primero su alcance.

4. En una terminal, inicia la API:

   ```powershell
   pnpm dev
   ```

   El backend queda disponible en `http://localhost:3000`. Déjalo ejecutándose.

5. En otra terminal, instala e inicia el frontend:

   ```powershell
   cd ..\codimac-frontend
   pnpm install
   pnpm dev
   ```

   Angular queda disponible en `http://localhost:8443` y reenvía las llamadas
   `/api` al backend local.

## Usuarios de demostración

Al cargar los fixtures de demostración:

| Correo | Rol | Contraseña inicial |
|---|---|---|
| `maria@codimac.pe` | Despachador | `demostracion` |
| `carlos@codimac.pe` | Chofer | `demostracion` |
| `jose@codimac.pe` | Administrador | `demostracion` |

Estas credenciales son solo para desarrollo y pruebas. Cámbialas en cualquier
entorno compartido o desplegado.

## Comandos útiles

Ejecuta los comandos desde la carpeta del proyecto correspondiente:

| Proyecto | Comando | Uso |
|---|---|---|
| Frontend | `pnpm dev` | Iniciar Angular en el puerto 8443 |
| Frontend | `pnpm build` | Generar el bundle de producción |
| Frontend | `pnpm typecheck` | Compilar Angular con comprobaciones estrictas |
| Frontend | `pnpm test` | Ejecutar las pruebas de Vitest |
| Backend | `pnpm dev` | Iniciar la API en el puerto 3000 |
| Backend | `pnpm build` | Compilar TypeScript |
| Backend | `pnpm test` | Ejecutar las pruebas de Vitest |
| Backend | `pnpm migrate` | Aplicar el esquema de base de datos |
| Backend | `pnpm seed` | Añadir datos de demostración faltantes |

Consulta [codimac-backend/README.md](./codimac-backend/README.md) para más
detalles sobre configuración, autenticación y endpoints.

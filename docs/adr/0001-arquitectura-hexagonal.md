# ADR-001: Adopción de arquitectura hexagonal en Codimac

| Campo | Valor |
|---|---|
| Estado de la decisión | Aceptada |
| Fecha del registro | 18 de octubre de 2026 |
| Proyecto | Codimac — gestión logística de pedidos, inventario y reparto |
| Decisión | Organizar el software mediante arquitectura hexagonal: puertos y adaptadores |
| Alcance | Organización interna del backend y del núcleo de negocio del frontend |

Esta decisión establece cómo separamos las reglas de negocio de la interfaz, la persistencia y los servicios externos de Codimac.

## 1. Contexto

Codimac administra pedidos, existencias, clientes, vehículos, planificación de rutas, entregas y auditoría. Sus reglas incluyen disponibilidad de stock, capacidad de carga, estados válidos y restricciones para asignar choferes y vehículos.

La solución actual contiene una aplicación web Angular, una API REST con Express y TypeScript y una base PostgreSQL. Además, utiliza adaptadores de mapas y servicios de autenticación. Estos detalles técnicos deben poder evolucionar sin obligar a reescribir las reglas del negocio.

Si las reglas se mezclan con componentes visuales, controladores HTTP o consultas SQL, resulta más difícil probarlas aisladamente y mantenerlas cuando cambia una tecnología. Se necesita separar las responsabilidades y expresar mediante contratos lo que cada caso de uso ofrece y requiere.

## 2. Factores de decisión

- Probar reglas y casos de uso sin iniciar Angular, Express o una base real en cada prueba.
- Mantener explícitas las reglas de pedidos, inventario, reparto y entrega.
- Aislar las decisiones de persistencia y proveedores externos detrás de contratos.
- Conservar en el servidor la autoridad sobre permisos, stock, estados y asignación de recursos.
- Permitir que las operaciones se invoquen desde HTTP y desde pruebas automatizadas.
- Mantener una estructura comprensible para el tamaño y alcance del proyecto.

## 3. Decisión

**Adoptamos la arquitectura hexagonal, también denominada puertos y adaptadores, para organizar el software de Codimac.**

El núcleo contiene las reglas de dominio y la coordinación de los casos de uso. Se comunica con su entorno mediante puertos, implementados o utilizados por adaptadores tecnológicos. La separación esencial es entre el interior de la aplicación y los mecanismos externos que la invocan o que satisfacen sus necesidades.

Buscamos ejecutar y probar las reglas y los casos de uso mediante distintos adaptadores, manteniendo su lógica separada de la interfaz y de las tecnologías externas.

### 3.1. Dominio

Contiene modelos, cálculos y reglas de negocio independientes de Angular, Express y PostgreSQL. Incluye estados de pedidos y rutas, reglas de inventario, cálculo de distancias, estimación de combustible y reglas de entrega.

Ubicaciones principales:

- `codimac-backend/src/domain/`
- `codimac-frontend/src/dominio/`

### 3.2. Aplicación y puertos de entrada

Los casos de uso coordinan las operaciones del negocio y exponen las capacidades disponibles para los adaptadores de entrada. Los contratos de entrada especifican qué puede solicitar un consumidor, sin requerir objetos HTTP ni componentes visuales.

En el backend, `OrderUseCases`, `RouteUseCases`, `CatalogUseCases` y `AuthenticationUseCases` describen estas capacidades. Sus implementaciones se construyen mediante funciones como `createOrderUseCases` y `createRouteUseCases`.

Ubicación principal: `codimac-backend/src/application/`.

El frontend también contiene casos de uso y puertos en `codimac-frontend/src/aplicacion/`; su uso efectivo depende de la pantalla y se detalla en el apartado de implementación actual.

### 3.3. Puertos de salida

Son contratos definidos desde las necesidades de la aplicación para obtener datos o ejecutar servicios externos. Incluyen `OrderRepository`, `RouteRepository`, `RegistroAuditoria`, `PasswordHasher` y `PasswordVerifier`.

Los contratos transaccionales, como `RouteTransaction` y `OrderRepositoryTransaction`, permiten coordinar operaciones relacionadas sin introducir `pg.PoolClient` en los casos de uso. La implementación concreta conserva la responsabilidad de abrir, confirmar o revertir la transacción.

No se exige crear una carpeta llamada `ports`: las interfaces existentes dentro de `application/` también cumplen esa función.

### 3.4. Adaptadores de entrada

Traducen una interacción externa a una operación de la aplicación:

- Los routers Express reciben solicitudes HTTP, validan su forma y llaman a los casos de uso.
- Las pantallas Angular reciben las acciones de los usuarios; utilizan el núcleo local o el cliente REST según la operación.
- Las pruebas automatizadas pueden invocar directamente los casos de uso y sustituir dependencias por dobles de prueba.

Ubicaciones principales: `codimac-backend/src/modules/`, `codimac-backend/src/http/` y `codimac-frontend/src/app/`.

### 3.5. Adaptadores de salida y composición

Las implementaciones concretas resuelven las necesidades expresadas por los puertos:

- `PostgresOrderRepository` y `PostgresRouteRepository`: persistencia mediante PostgreSQL.
- `PostgresRegistroAuditoria`: escritura de eventos de auditoría.
- `BcryptPasswordHasher`: generación de hashes de contraseñas.
- `EstimadorLocal`: implementación existente de `ServicioMapas` para cálculo local.

La selección y conexión de implementaciones se realiza fuera del núcleo. El archivo `codimac-backend/src/app.ts` actúa como punto de composición del backend. Por ejemplo:

```typescript
const routeUseCases = createRouteUseCases(new PostgresRouteRepository())
app.use("/api", createRoutesRouter(routeUseCases))
```

El caso de uso recibe un `RouteRepository`; la elección de PostgreSQL ocurre al componer la aplicación. Cambiar el adaptador exige respetar el contrato y verificar el comportamiento, incluidas las garantías transaccionales.

## 4. Regla de dependencias

Organizamos las dependencias hacia el núcleo: los adaptadores de entrada invocan los casos de uso, los casos de uso aplican las reglas de dominio y utilizan puertos de salida, y los adaptadores de salida implementan esos contratos. La composición conecta los casos de uso con sus implementaciones concretas.

El dominio no debe importar controladores, componentes Angular, clientes PostgreSQL ni SDK de proveedores. Los casos de uso no deben crear directamente repositorios PostgreSQL ni conocer `Request` o `Response` de Express.

Un puerto es un contrato de software: no equivale a un puerto TCP como 3000 u 8443. El término «hexagonal» tampoco exige seis capas, seis módulos o seis servicios.

## 5. Organización del backend

El cliente Angular envía solicitudes HTTP a los routers de Express. Los routers validan las solicitudes e invocan las operaciones expuestas por los casos de uso de pedidos, rutas y los demás módulos. Los casos de uso aplican las reglas del dominio y solicitan persistencia o auditoría mediante sus puertos de salida. Los adaptadores PostgreSQL implementan esos contratos y ejecutan las consultas y transacciones.

El frontend y el backend son aplicaciones distintas comunicadas por HTTP. Intercambian datos mediante JSON y mantienen sus propios modelos y contratos TypeScript.

## 6. Correspondencia con la implementación

| Responsabilidad | Evidencia |
|---|---|
| Reglas independientes del transporte | [`domain/rules.ts`](../../codimac-backend/src/domain/rules.ts), [`domain/routing.ts`](../../codimac-backend/src/domain/routing.ts) y [`dominio/rutas.ts`](../../codimac-frontend/src/dominio/rutas.ts). |
| Casos de uso y contratos de entrada | [`application/orders.ts`](../../codimac-backend/src/application/orders.ts) y [`application/routes.ts`](../../codimac-backend/src/application/routes.ts). |
| Contratos de salida | `OrderRepository`, `RouteRepository` y sus contratos transaccionales en los archivos anteriores; [`RegistroAuditoria`](../../codimac-backend/src/application/registro-auditoria.ts). |
| Adaptador de entrada HTTP | [`modules/orders.router.ts`](../../codimac-backend/src/modules/orders.router.ts) y [`modules/routes.router.ts`](../../codimac-backend/src/modules/routes.router.ts). |
| Adaptadores de persistencia | [`PostgresOrderRepository`](../../codimac-backend/src/adapters/postgres-order-repository.ts) y [`PostgresRouteRepository`](../../codimac-backend/src/adapters/postgres-route-repository.ts). |
| Punto de composición | [`app.ts`](../../codimac-backend/src/app.ts). |
| Caso de uso y puerto de planificación existentes | [`PlanificarReparto`](../../codimac-frontend/src/aplicacion/planificar-reparto.ts), [`ServicioMapas`](../../codimac-frontend/src/aplicacion/puertos.ts) y [`EstimadorLocal`](../../codimac-frontend/src/adaptadores/mapas/estimador-local.ts). |

## 7. Estado actual y limitaciones

Aplicamos esta separación especialmente en los casos de uso del backend y sus repositorios inyectados. Mantenemos identificadas las siguientes limitaciones de la implementación:

1. **Planificación desde la pantalla.** `RoutesPageComponent` llama directamente a `generarAlternativas` del dominio. La clase `PlanificarReparto` y el puerto `ServicioMapas` existen y están probados, pero no forman parte del camino actual de esa pantalla. La llamada al dominio conserva el cálculo separado de Angular, aunque parte de la coordinación permanece en el componente.
2. **Acceso directo a persistencia.** `modules/shared.router.ts`, `modules/public.router.ts`, `modules/auth.router.ts` y `http/auth.ts` contienen accesos directos al pool PostgreSQL. Esas operaciones no pasan íntegramente por los puertos de aplicación descritos, por lo que la separación todavía no es uniforme en todos los módulos.
3. **Puerto técnico de mapas.** `PuertoUbicacionMapa` permite cambiar entre los adaptadores Google Maps y Leaflet, pero su contrato utiliza `HTMLElement` y `HTMLInputElement`. Aísla al proveedor dentro del entorno del navegador; no es una abstracción de dominio independiente de la interfaz.
4. **Reglas en dos aplicaciones.** Existen modelos y reglas en el frontend y en el backend. Se necesita mantener coherencia entre ellos; la presencia de carpetas semejantes no equivale a compartir automáticamente el mismo código.
5. **Estimaciones y autoridad del servidor.** La comparación inicial de rutas se calcula en el navegador. El backend recibe y guarda esas métricas; valida pedidos, estados, recursos y capacidad, pero no vuelve a ejecutar la optimización. Google Maps se abre para visualizar la secuencia y no suministra tráfico real al cálculo actual.

La separación de estas conexiones directas queda como trabajo pendiente de mantenimiento.

## 8. Alternativas contrastadas

La elección se justifica mediante la siguiente comparación de estructura, mantenimiento y facilidad de prueba:

| Alternativa | Ventaja | Motivo para preferir puertos y adaptadores en Codimac |
|---|---|---|
| Concentrar lógica en pantallas, controladores y consultas SQL | Menos contratos iniciales y acceso directo a los datos. | Vincula las reglas a los detalles visuales y de infraestructura; dificulta las pruebas aisladas y aumenta el alcance de los cambios. |
| Separación convencional por capas sin exigir contratos de dependencia | Estructura conocida de presentación, servicios y datos. | La separación de carpetas no garantiza que los casos de uso dependan de abstracciones. Se adopta además una regla explícita de puertos y adaptadores; una organización por capas puede coexistir con ella. |
| Aplicar todas las convenciones de Clean Architecture | Límites y responsabilidades más prescriptivos. | Se prefiere documentar los puertos y adaptadores ya presentes, sin exigir estructuras adicionales que el alcance actual no necesita. Ambos enfoques comparten objetivos de independencia del núcleo. |

La arquitectura hexagonal no exige microservicios. Mantenemos el frontend y la API como aplicaciones separadas, sin añadir comunicación distribuida entre servicios de negocio.

## 9. Consecuencias

### Favorables

- Las reglas y los casos de uso pueden probarse con dependencias sustituidas por dobles de prueba.
- La persistencia y otros servicios técnicos tienen responsabilidades identificables.
- Las validaciones de negocio pueden mantenerse separadas del transporte HTTP.
- Las dependencias explícitas facilitan entender qué requiere cada operación y dónde conectar una implementación.
- Las pruebas de integración pueden verificar los adaptadores reales sin convertir cada prueba de negocio en una prueba de infraestructura.

### Desfavorables

- **Mayor esfuerzo inicial.** Definir puertos, adaptadores, datos de entrada y composición requiere más trabajo que resolver una operación sencilla directamente en un controlador.
- **Más archivos y recorridos para comprender una operación.** Para seguir una solicitud es necesario revisar el adaptador de entrada, el caso de uso, el contrato y la implementación concreta. Esto aumenta el esfuerzo de incorporación al proyecto y de depuración.
- **Mayor costo de cambiar contratos.** Modificar un puerto puede obligar a actualizar sus adaptadores, dobles de prueba y puntos de composición. Una interfaz mal definida amplía el impacto de los cambios.
- **Complejidad en las transacciones.** Los contratos de pedidos y rutas deben representar bloqueos, reservas, auditoría y cambios de estado coordinados. Esto hace más exigente implementar y probar un nuevo adaptador de persistencia.
- **Riesgo de abstracciones innecesarias.** Crear interfaces para operaciones que no necesitan separación puede añadir código y mantenimiento sin aportar un beneficio suficiente.
- **Sustitución de infraestructura con costo real.** Cambiar PostgreSQL requiere adaptar consultas, esquema, restricciones y garantías transaccionales; implementar la misma interfaz no garantiza por sí solo un comportamiento equivalente.
- **Mantenimiento de reglas en dos aplicaciones.** Los conceptos presentes en frontend y backend pueden divergir si cambiamos validaciones o modelos sin revisar ambas implementaciones.

### Trade-offs aceptados

| Beneficio buscado | Costo o desventaja que aceptamos | Criterio aplicado en Codimac |
|---|---|---|
| Probar los casos de uso sin depender de una base real | Mantener contratos y dobles de prueba adicionales | Priorizamos pruebas aisladas para stock, estados, capacidad y asignación de recursos. |
| Separar las reglas de HTTP y de PostgreSQL | Recorrer más archivos para implementar o depurar una operación | Mantenemos responsabilidades explícitas y concentramos la composición de dependencias en puntos identificables. |
| Poder incorporar otro proveedor o adaptador | Desarrollar y verificar una implementación nueva, además de adaptar los detalles de infraestructura | Mantenemos PostgreSQL como implementación actual y conservamos contratos donde existe una necesidad concreta de separación. |
| Conservar la consistencia de inventario, rutas y auditoría | Diseñar contratos transaccionales más amplios y difíciles de sustituir | Priorizamos la integridad de las operaciones sobre una interfaz de persistencia demasiado genérica. |

Aceptamos este mayor esfuerzo de desarrollo y mantenimiento porque los cambios en las reglas de pedidos, inventario y reparto requieren pruebas y responsabilidades claras. Evitamos añadir abstracciones únicamente para aumentar el número de capas o interfaces.

## 10. Criterios para mantener la decisión

Las nuevas funcionalidades que sigan esta arquitectura deberán cumplir los siguientes criterios:

- Las reglas de dominio no dependen de frameworks de interfaz, transporte o persistencia.
- Los casos de uso reciben las dependencias externas por contrato.
- Los adaptadores HTTP convierten solicitudes y respuestas sin concentrar las reglas de negocio.
- SQL, SDK y detalles del proveedor permanecen en adaptadores o infraestructura.
- Las operaciones críticas de estado, inventario y asignación mantienen validación y consistencia en el backend.
- Las pruebas distinguen reglas y casos de uso, contratos HTTP y adaptadores reales.
- Las conexiones que se aparten de estas reglas se documentan para su revisión y mantenimiento.

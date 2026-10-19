# Proceso 3 — Gestión y asignación de conductores

**Responsable:** Gustavo Corahua Bravo
**Inicio:** ruta en estado `Calculada`.
**Fin:** ruta `Asignada` con chofer y vehículo vinculados, sin exceder el peso en kg.

```mermaid
sequenceDiagram
    actor Desp as Despachador
    participant UI as Repartos (Angular)
    participant API as API Express
    participant UC as Caso de uso de rutas
    participant DB as PostgreSQL

    Desp->>UI: Abre asignación de recursos
    UI->>API: GET /api/resources
    API->>DB: profiles y vehicles disponibles
    API-->>UI: Choferes y vehículos Disponible
    Desp->>UI: Aprueba la ruta
    UI->>API: POST /api/routes/:id/approve
    API->>DB: routes = Aprobada
    Desp->>UI: Elige chofer y vehículo
    UI->>API: POST /api/routes/:id/assign
    API->>UC: assign()
    UC->>DB: bloquea chofer y vehículo; valida que no tengan ruta activa
    UC->>UC: carga (kg) no supera la capacidad del vehículo
    UC->>DB: routes = Asignada, vehicles.available = false, status_events, auditoria_eventos
```

# Proceso 4 — Ejecución y seguimiento de entregas

**Responsable:** Carlos Daniel Huachallanqui Olivera
**Inicio:** el chofer inicia la ruta `Asignada` (pasa a `En curso`).
**Fin:** el cliente consulta el seguimiento en el portal de 5 pasos, o el chofer llega a la parada.

```mermaid
sequenceDiagram
    actor Chofer
    actor Cliente
    participant UI as Vista móvil del chofer (Angular)
    participant POR as Portal público (Angular)
    participant API as API Express
    participant DB as PostgreSQL

    Chofer->>UI: Inicia ruta
    UI->>API: POST /api/routes/:id/start (Bearer)
    API->>DB: routes = En curso (started_at); primera parada En camino; pedido En ruta
    UI->>API: GET /api/driver/route
    API-->>UI: Paradas y ETA
    Chofer->>UI: Pulsa "Cómo llegar"
    UI-->>Chofer: Abre navegación en Google Maps
    Cliente->>POR: Ingresa código y últimos 4 dígitos del teléfono
    POR->>API: POST /api/tracking
    Note over API: Limita a 5 fallos por IP; responde 429 al sexto
    API->>DB: orders, route_stops, clients
    API-->>POR: Paso 1 a 5; posición y ETA solo si está En camino
```

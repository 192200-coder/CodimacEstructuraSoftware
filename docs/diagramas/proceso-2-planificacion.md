# Proceso 2 — Planificación y optimización inteligente de rutas

**Responsable:** Maykol David Espinoza Kquerare
**Inicio:** el despachador selecciona pedidos en `Listo`.
**Fin:** ruta en estado `Calculada` con orden, km, min, litros y costo (S/).

```mermaid
sequenceDiagram
    actor Desp as Despachador
    participant UI as Panel Repartos (Angular)
    participant EST as Estimador local (dominio/rutas.ts)
    participant API as API Express
    participant DB as PostgreSQL

    Desp->>UI: Selecciona pedidos Listo (máx. 10 paradas)
    UI->>EST: generarAlternativas(origen, destinos, vehículo)
    Note over EST: Haversine x1,35; permutaciones si hay 8 o menos paradas, vecino más cercano si hay más
    EST-->>UI: Alternativas con km, min, litros y costo
    Desp->>UI: Elige criterio y alternativa
    UI->>API: POST /api/routes
    API->>DB: routes (Calculada), route_stops, status_events, auditoria_eventos
```

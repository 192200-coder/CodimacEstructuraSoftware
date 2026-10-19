# Proceso 5 — Control y cierre de repartos

**Responsable:** Yaison Terry Huamani Carhuaricra
**Inicio:** el chofer atiende una parada (entrega o incidencia).
**Fin:** ruta `Cerrada`, con stock descontado y auditoría registrada.

```mermaid
sequenceDiagram
    actor Chofer
    participant UI as Vista Chofer (Angular)
    participant API as API Express
    participant UC as Caso de uso de rutas
    participant DOM as Dominio (rules / routing)
    participant DB as PostgreSQL
    actor Desp as Despachador

    Chofer->>UI: Confirma entrega o reporta incidencia
    UI->>API: POST /api/stops/:id/deliver | /incidents (Bearer)
    API->>API: authenticate + requireRole("Chofer") + zod
    API->>UC: deliver() / reportIncident()
    UC->>DB: BEGIN; SELECT route_stops, routes FOR UPDATE
    alt Entrega
        UC->>DB: route_stops=Entregada, orders=Entregado
        UC->>DB: products (stock), stock_reservations, inventory_movements SALIDA
    else Incidencia
        UC->>DOM: nextIncident(attempts)
        DOM-->>UC: intento 1 = Incidencia, intento 2 = No entregada
        UC->>DB: incidents, route_stops
        opt Intento 1
            UC->>DOM: orderOpenStops (Haversine local)
            UC->>DB: reordena route_stops pendientes
        end
        opt Intento 2
            UC->>DB: orders=Listo (conserva reserva)
        end
    end
    UC->>DB: status_events + auditoria_eventos
    opt Sin paradas sin resolver
        UC->>DB: routes=Cerrada (closed_at), libera vehículo y pedidos
    end
    UC->>DB: COMMIT (ROLLBACK ante error)
    API-->>UI: { status } | { result }
    Desp->>API: GET /api/routes (polling) y GET /api/routes/history
    API-->>Desp: avance, ETA e indicadores
```

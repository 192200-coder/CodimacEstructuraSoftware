# Proceso 1 — Gestión de solicitudes de reparto

**Responsable:** Maria Magdalena Villegas Huamani
**Inicio:** el cliente solicita un pedido o registro.
**Fin:** pedido en estado `Listo`, con ubicación en mapa y stock reservado.

```mermaid
sequenceDiagram
    actor Cliente
    actor Desp as Despachador
    participant UI as Angular (Clientes / Pedidos)
    participant API as API Express
    participant UC as Caso de uso de pedidos
    participant DB as PostgreSQL

    Cliente->>Desp: Solicita pedido / registro
    Desp->>UI: Registra cliente (dirección, referencia, mapa)
    UI->>API: POST /api/catalog/clients
    API->>DB: clients
    Desp->>UI: Crea pedido con líneas
    UI->>API: POST /api/orders
    API->>UC: crear pedido (valida stock)
    UC->>DB: orders, order_items, stock_reservations, products
    Desp->>UI: Prepara y marca listo
    UI->>API: POST /api/orders/:id/prepare, /ready
    API->>DB: orders = Listo, status_events, auditoria_eventos
```

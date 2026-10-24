export type Role =
  | "Despachador"
  | "Administrador"
  | "Chofer"
  | "Cliente"
  | "Acceso"

export type DialogKind =
  | "order"
  | "client"
  | "inventory-entry"
  | "inventory-adjust"
  | "user"
  | "product"
  | "vehicle"
  | "resources"

export interface NavItem {
  label: string
  icon: string
  count?: number
}

export const roleNavigation: Record<Role, NavItem[]> = {
  Despachador: [
    { label: "Panel", icon: "grid" },
    { label: "Pedidos", icon: "box" },
    { label: "Inventario", icon: "warehouse" },
    { label: "Clientes", icon: "users" },
    { label: "Repartos", icon: "truck" },
    { label: "Historial", icon: "history" },
  ],
  Administrador: [
    { label: "Indicadores", icon: "chart" },
    { label: "Usuarios", icon: "users" },
    { label: "Productos", icon: "box" },
    { label: "Vehículos", icon: "truck" },
    { label: "Parámetros", icon: "sliders" },
    { label: "Historial", icon: "history" },
    { label: "Auditoría", icon: "shield" },
    { label: "Datos de ejemplo", icon: "database" },
  ],
  Chofer: [
    { label: "Mi ruta", icon: "route" },
    { label: "Perfil", icon: "user" },
  ],
  Cliente: [{ label: "Consultar entrega", icon: "search" }],
  Acceso: [
    { label: "Iniciar sesión", icon: "user" },
    { label: "Sin acceso", icon: "close" },
  ],
}

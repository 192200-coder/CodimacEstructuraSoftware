import { Component, Input } from "@angular/core"
import { IconComponent } from "./icon.component"

export type StatusKind = "pedido" | "parada"

interface Presentation {
  className: string
  icon: string
}

// Sección 9.1: cada estado se distingue por color, ícono y texto, nunca solo por color (RNF-25).
const presentations: Record<string, Presentation> = {
  // Pedido y portal del cliente
  Pendiente: { className: "pending", icon: "clock" },
  Registrado: { className: "pending", icon: "clock" },
  "En preparación": { className: "preparing", icon: "box" },
  Listo: { className: "ready", icon: "checkCircle" },
  "Listo para salir": { className: "ready", icon: "checkCircle" },
  "En ruta": { className: "route-status", icon: "truck" },
  "En camino": { className: "route-status", icon: "truck" },
  Entregado: { className: "delivered", icon: "checkCheck" },
  Cancelado: { className: "cancelled", icon: "xCircle" },
  Reprogramado: { className: "incident", icon: "history" },
  // Parada
  Entregada: { className: "delivered", icon: "check" },
  Incidencia: { className: "incident", icon: "alertTriangle" },
  "No entregada": { className: "cancelled", icon: "close" },
  // Ruta
  Calculada: { className: "pending", icon: "route" },
  Aprobada: { className: "ready", icon: "checkCircle" },
  Asignada: { className: "assigned", icon: "user" },
  "En curso": { className: "route-status", icon: "truck" },
  Cerrada: { className: "delivered", icon: "checkCheck" },
  // Inventario, usuarios y recursos
  "Sin stock": { className: "cancelled", icon: "xCircle" },
  "Stock bajo": { className: "incident", icon: "alertTriangle" },
  Disponible: { className: "delivered", icon: "checkCircle" },
  Activo: { className: "delivered", icon: "checkCircle" },
  Inactivo: { className: "muted", icon: "xCircle" },
  "No disponible": { className: "muted", icon: "close" },
}

/** La parada usa su propia variante: Pendiente con punto y En camino en azul con flecha. */
const stopPresentations: Record<string, Presentation> = {
  Pendiente: { className: "pending", icon: "dot" },
  "En camino": { className: "on-way", icon: "arrowRight" },
}

@Component({
  selector: "codimac-status",
  standalone: true,
  imports: [IconComponent],
  template: `<span [class]="badgeClass"><codimac-icon [name]="iconName" [size]="13" />{{ status }}</span>`,
})
export class StatusBadgeComponent {
  @Input({ required: true }) status = ""
  @Input() kind: StatusKind = "pedido"

  private get presentation(): Presentation {
    return (this.kind === "parada" ? stopPresentations[this.status] : undefined)
      ?? presentations[this.status]
      ?? { className: "pending", icon: "dot" }
  }

  get badgeClass(): string {
    return `status-badge ${this.presentation.className}`
  }

  get iconName(): string {
    return this.presentation.icon
  }
}

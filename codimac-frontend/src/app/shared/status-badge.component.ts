import { Component, Input } from "@angular/core"
import { IconComponent } from "./icon.component"

@Component({
  selector: "codimac-status",
  standalone: true,
  imports: [IconComponent],
  template: `<span [class]="badgeClass"><codimac-icon [name]="iconName" [size]="13" />{{ status }}</span>`,
})
export class StatusBadgeComponent {
  @Input({ required: true }) status = ""

  private readonly presentations: Record<string, { className: string; icon: string }> = {
    Pendiente: { className: "pending", icon: "clock" },
    Registrado: { className: "pending", icon: "clock" },
    "En preparación": { className: "preparing", icon: "box" },
    Listo: { className: "ready", icon: "checkCircle" },
    "Listo para salir": { className: "ready", icon: "checkCircle" },
    "En camino": { className: "route-status", icon: "truck" },
    "En ruta": { className: "route-status", icon: "truck" },
    Asignada: { className: "route-status", icon: "truck" },
    Entregado: { className: "delivered", icon: "checkCheck" },
    Entregada: { className: "delivered", icon: "checkCheck" },
    Cerrada: { className: "delivered", icon: "checkCheck" },
    Aprobada: { className: "ready", icon: "checkCircle" },
    Cancelado: { className: "cancelled", icon: "xCircle" },
    "No entregada": { className: "cancelled", icon: "xCircle" },
    Reprogramado: { className: "incident", icon: "history" },
    Incidencia: { className: "incident", icon: "history" },
    "Stock bajo": { className: "incident", icon: "box" },
    Activo: { className: "delivered", icon: "checkCircle" },
    Disponible: { className: "delivered", icon: "checkCircle" },
  }

  get badgeClass(): string {
    return `status-badge ${this.presentations[this.status]?.className ?? "pending"}`
  }

  get iconName(): string {
    return this.presentations[this.status]?.icon ?? "clock"
  }
}

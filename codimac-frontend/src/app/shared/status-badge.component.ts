import { Component, Input } from "@angular/core"

@Component({
  selector: "codimac-status",
  standalone: true,
  template: `<span [class]="badgeClass">{{ status }}</span>`,
})
export class StatusBadgeComponent {
  @Input({ required: true }) status = ""

  get badgeClass(): string {
    const classes: Record<string, string> = {
      Pendiente: "status-badge pending",
      "En preparación": "status-badge preparing",
      Listo: "status-badge on-way",
      "En camino": "status-badge on-way",
      "En ruta": "status-badge route-status",
      Entregado: "status-badge delivered",
      Entregada: "status-badge delivered",
      Activo: "status-badge delivered",
      Disponible: "status-badge delivered",
      Incidencia: "status-badge incident",
      "Stock bajo": "status-badge incident",
      "No entregada": "status-badge cancelled",
      Cancelado: "status-badge cancelled",
    }
    return classes[this.status] ?? "status-badge pending"
  }
}

import { describe, expect, it } from "vitest"
import { StatusBadgeComponent } from "./status-badge.component"

describe("presentación visual de estados", () => {
  it("distingue En preparación y Cancelado mediante texto, color e icono", () => {
    const preparing = new StatusBadgeComponent()
    preparing.status = "En preparación"
    const cancelled = new StatusBadgeComponent()
    cancelled.status = "Cancelado"

    expect(preparing.status).toBe("En preparación")
    expect(preparing.badgeClass).toContain("preparing")
    expect(preparing.iconName).toBe("box")
    expect(cancelled.status).toBe("Cancelado")
    expect(cancelled.badgeClass).toContain("cancelled")
    expect(cancelled.iconName).toBe("xCircle")
  })

  it.each([
    ["Pendiente", "clock"],
    ["Listo", "checkCircle"],
    ["En ruta", "truck"],
    ["Entregado", "checkCheck"],
  ])("mantiene icono oficial para %s", (status, icon) => {
    const badge = new StatusBadgeComponent()
    badge.status = status

    expect(badge.iconName).toBe(icon)
  })
})

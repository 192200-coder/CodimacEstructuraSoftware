import { describe, expect, it } from "vitest"
import {
  clientTelephoneUrl,
  driverDirectionsUrl,
  driverMapPreviewUrl,
} from "./driver-links"

describe("enlaces de ubicación y contacto del chofer", () => {
  it("genera la URL de Cómo llegar con las coordenadas de destino", () => {
    expect(driverDirectionsUrl(-13.63, -72.88)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=-13.63,-72.88",
    )
  })

  it("omite enlaces de mapa cuando las coordenadas no son válidas", () => {
    expect(driverDirectionsUrl(91, 0)).toBeNull()
    expect(driverMapPreviewUrl(Number.NaN, 0)).toBeNull()
  })

  it("prepara una vista previa OpenStreetMap de solo lectura", () => {
    const preview = driverMapPreviewUrl(-13.63, -72.88)
    expect(preview).not.toBeNull()
    const url = new URL(preview!)
    expect(url.origin).toBe("https://www.openstreetmap.org")
    expect(url.pathname).toBe("/export/embed.html")
    expect(url.searchParams.get("marker")).toBe("-13.63,-72.88")
    expect(url.searchParams.get("layer")).toBe("mapnik")
  })

  it("construye el enlace telefónico peruano sin duplicar el prefijo", () => {
    expect(clientTelephoneUrl("912345678")).toBe("tel:+51912345678")
    expect(clientTelephoneUrl("+51 912 345 678")).toBe("tel:+51912345678")
    expect(clientTelephoneUrl(null)).toBeNull()
  })
})

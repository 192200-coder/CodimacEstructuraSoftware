import { z } from "zod"

export const publicTrackingCredentialsSchema = z.object({
  codigo: z.string().trim().min(1).max(80),
  ultimos4: z.string().regex(/^\d{4}$/),
}).strict()

export type PublicTrackingStatus =
  | "Registrado"
  | "En preparación"
  | "Listo para salir"
  | "En camino"
  | "Entregado"
  | "Cancelado"
  | "Reprogramado"
  | "No entregada"

const portalSteps: Partial<Record<PublicTrackingStatus, number>> = {
  Registrado: 1,
  "En preparación": 2,
  "Listo para salir": 3,
  "En camino": 4,
  Entregado: 5,
}

export function mapPublicTrackingStatus(
  orderStatus: string,
  stopStatus: string | null,
): PublicTrackingStatus {
  if (orderStatus === "Cancelado") return "Cancelado"
  if (stopStatus === "No entregada") return "No entregada"
  if (stopStatus === "Incidencia") return "Reprogramado"

  switch (orderStatus) {
    case "Pendiente":
      return "Registrado"
    case "En preparación":
      return "En preparación"
    case "Listo":
      return "Listo para salir"
    case "En ruta":
      return "En camino"
    case "Entregado":
      return "Entregado"
    default:
      return "Registrado"
  }
}

export function getPortalStep(status: PublicTrackingStatus): number | null {
  return portalSteps[status] ?? null
}

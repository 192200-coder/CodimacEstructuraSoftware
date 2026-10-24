import { Component, signal } from "@angular/core"
import { FechaPipe } from "../../shared/fecha.pipe"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import { StatusBadgeComponent } from "../../shared/status-badge.component"
import type { PublicTracking } from "../../../lib/codimac-api"
import { validarConsultaPortal } from "../../../dominio/validaciones"

const trackingSteps = [
  { number: 1, label: "Registrado", icon: "clock" },
  { number: 2, label: "En preparación", icon: "box" },
  { number: 3, label: "Listo para salir", icon: "checkCircle" },
  { number: 4, label: "En camino", icon: "truck" },
  { number: 5, label: "Entregado", icon: "checkCheck" },
] as const

@Component({
  selector: "codimac-client",
  standalone: true,
  imports: [FormsModule, IconComponent, StatusBadgeComponent, FechaPipe],
  templateUrl: "./client-feature.component.html",
})
export class ClientFeatureComponent {
  readonly trackingSteps = trackingSteps
  readonly found = signal(false)
  readonly reprogrammed = signal(false)
  readonly deliveryFailed = signal(false)
  readonly loading = signal(false)
  readonly error = signal("")
  readonly code = signal("")
  readonly lastFourDigits = signal("")
  readonly trackingCode = signal("")
  readonly tracking = signal<PublicTracking | null>(null)

  get trackingTitle(): string {
    if (this.deliveryFailed()) return "No se pudo completar la entrega"
    if (this.reprogrammed()) return "Reprogramamos tu entrega"
    switch (this.tracking()?.public_status) {
      case "Registrado": return "Tu pedido está registrado"
      case "En preparación": return "Tu pedido está en preparación"
      case "Listo para salir": return "Tu pedido está listo para salir"
      case "En camino": return "Tu pedido está en camino"
      case "Entregado": return "Tu pedido fue entregado"
      case "Cancelado": return "Pedido cancelado"
      default: return "Estado de entrega actualizado"
    }
  }

  get trackingMessage(): string {
    if (this.deliveryFailed()) return "Los intentos de entrega de este reparto finalizaron. El pedido volvió a quedar disponible para coordinación; comunícate con CODIMAC para programar el siguiente paso."
    if (this.reprogrammed()) return "No pudimos completar la primera visita. Haremos un nuevo intento."
    switch (this.tracking()?.public_status) {
      case "Registrado": return "Recibimos tu pedido y pronto comenzaremos a prepararlo."
      case "En preparación": return "Estamos preparando tu pedido para el despacho."
      case "Listo para salir": return "Tu pedido está listo y pendiente de iniciar su reparto."
      case "En camino": return "Estamos llevando tu pedido al destino registrado."
      case "Entregado": return "La entrega de tu pedido fue completada."
      case "Cancelado": return "Este pedido fue cancelado. Comunícate con CODIMAC si necesitas más información."
      default: return "Consulta nuevamente más tarde para ver el estado actualizado."
    }
  }

  isCancelled(): boolean {
    return this.tracking()?.public_status === "Cancelado"
  }

  // Una entrega reprogramada sigue en el paso 4 (En camino), con el aviso de reprogramación.
  isStepDone(step: number): boolean {
    const tracking = this.tracking()
    return tracking?.public_status === "Entregado"
      || (this.reprogrammed() && step < 4)
      || (tracking?.current_step !== null && tracking?.current_step !== undefined && step < tracking.current_step)
  }

  isStepActive(step: number): boolean {
    return (this.tracking()?.current_step === step && this.tracking()?.public_status !== "Entregado")
      || (this.reprogrammed() && step === 4)
  }

  stepDescription(step: number): string {
    const tracking = this.tracking()
    if (this.reprogrammed() && step === 4) return "Reprogramado"
    if (tracking?.public_status === "Entregado") return "Completado"
    if (tracking?.current_step === step) return "Ahora"
    return tracking?.current_step && tracking.current_step > step ? "Completado" : "Próximamente"
  }

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {}

  updateCode(event: Event): void {
    this.code.set((event.target as HTMLInputElement).value.trim())
    this.error.set("")
  }

  updateLastFourDigits(event: Event): void {
    this.lastFourDigits.set((event.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 4))
    this.error.set("")
  }

  async consult(): Promise<void> {
    if (this.loading()) return
    const code = this.code().trim()
    const lastFourDigits = this.lastFourDigits()
    const errors = validarConsultaPortal({ codigo: code, ultimos4: lastFourDigits })
    if (Object.keys(errors).length) {
      this.error.set(Object.values(errors).join(" "))
      return
    }
    this.loading.set(true)
    this.error.set("")
    try {
      const result = await this.api.getTracking(code, lastFourDigits)
      this.trackingCode.set(result.tracking.code)
      this.tracking.set(result.tracking)
      this.reprogrammed.set(result.tracking.public_status === "Reprogramado")
      this.deliveryFailed.set(result.tracking.public_status === "No entregada")
      this.found.set(true)
    } catch (error) {
      this.error.set(error instanceof Error
        ? error.message
        : "No encontramos un pedido con esos datos.")
    } finally {
      this.loading.set(false)
    }
  }

  resetConsultation(): void {
    this.found.set(false)
    this.error.set("")
    this.tracking.set(null)
    this.trackingCode.set("")
    this.lastFourDigits.set("")
    this.reprogrammed.set(false)
    this.deliveryFailed.set(false)
  }

  async returnToLogin(): Promise<void> {
    try {
      await this.state.logout()
    } catch (error) {
      this.state.showToast(
        error instanceof Error ? error.message : "No se pudo cerrar la sesión.",
      )
    }
  }
}

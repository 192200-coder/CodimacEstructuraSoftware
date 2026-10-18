import { Component, signal } from "@angular/core"
import { DatePipe } from "@angular/common"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { CodimacApiService } from "../../core/codimac-api.service"
import { IconComponent } from "../../shared/icon.component"
import type { PublicTracking } from "../../../lib/codimac-api"

@Component({
  selector: "codimac-client",
  standalone: true,
  imports: [FormsModule, IconComponent, DatePipe],
  templateUrl: "./client-feature.component.html",
})
export class ClientFeatureComponent {
  readonly found = signal(false)
  readonly reprogrammed = signal(false)
  readonly deliveryFailed = signal(false)
  readonly loading = signal(false)
  readonly error = signal("")
  readonly code = signal("")
  readonly trackingCode = signal("")
  readonly tracking = signal<PublicTracking | null>(null)

  constructor(
    readonly state: AppStateService,
    private readonly api: CodimacApiService,
  ) {}

  updateCode(event: Event): void {
    this.code.set((event.target as HTMLInputElement).value.trim())
    this.error.set("")
  }

  async consult(): Promise<void> {
    const code = this.code().trim()
    if (!code) {
      this.error.set("Ingresa el código privado de seguimiento que recibiste al registrar el pedido.")
      return
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code)) {
      this.error.set("Ese formato no corresponde al código privado. No uses el código visible del pedido (por ejemplo, COD-101); solicita o pega el UUID de seguimiento.")
      return
    }
    this.loading.set(true)
    this.error.set("")
    try {
      const result = await this.api.getTracking(code)
      this.trackingCode.set(result.tracking.code)
      this.tracking.set(result.tracking)
      this.reprogrammed.set(result.tracking.public_status === "Reprogramado")
      this.deliveryFailed.set(result.tracking.public_status === "No entregada")
      this.found.set(true)
    } catch (error) {
      this.error.set(error instanceof Error
        ? error.message
        : "No encontramos un pedido asociado a ese código privado.")
    } finally {
      this.loading.set(false)
    }
  }

  resetConsultation(): void {
    this.found.set(false)
    this.error.set("")
    this.tracking.set(null)
    this.trackingCode.set("")
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

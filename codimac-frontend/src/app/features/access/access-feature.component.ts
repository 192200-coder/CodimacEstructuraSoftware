import { Component, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { IconComponent } from "../../shared/icon.component"

@Component({
  selector: "codimac-access",
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: "./access-feature.component.html",
})
export class AccessFeatureComponent {
  readonly loading = signal(false)
  readonly showError = signal(false)
  email = ""
  password = ""

  constructor(readonly state: AppStateService) {}

  async login(): Promise<void> {
    this.loading.set(true)
    this.showError.set(false)
    try {
      const destination = await this.state.authenticate(this.email, this.password)
      this.state.showToast(`Sesión iniciada como ${destination}.`)
    } catch (error) {
      this.showError.set(true)
      this.state.showToast(
        error instanceof Error ? error.message : "Correo o contraseña incorrectos.",
      )
    } finally {
      this.loading.set(false)
    }
  }
}

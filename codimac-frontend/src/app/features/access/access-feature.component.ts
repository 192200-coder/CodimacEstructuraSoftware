import { Component, signal } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { AppStateService } from "../../core/app-state.service"
import { IconComponent } from "../../shared/icon.component"
import { validarInicioSesion, type ErroresCampo } from "../../../dominio/validaciones"

@Component({
  selector: "codimac-access",
  standalone: true,
  imports: [FormsModule, IconComponent],
  templateUrl: "./access-feature.component.html",
})
export class AccessFeatureComponent {
  readonly loading = signal(false)
  readonly loginError = signal("")
  readonly errors = signal<ErroresCampo>({})
  email = ""
  password = ""

  constructor(readonly state: AppStateService) {}

  error(field: string): string {
    return this.errors()[field] ?? ""
  }

  validateField(field: string): void {
    const message = validarInicioSesion({ email: this.email, password: this.password })[field]
    this.errors.update((errors) => {
      const { [field]: _previous, ...rest } = errors
      return message ? { ...rest, [field]: message } : rest
    })
  }

  async login(): Promise<void> {
    if (this.loading()) return
    const errors = validarInicioSesion({ email: this.email, password: this.password })
    this.errors.set(errors)
    this.loginError.set("")
    if (Object.keys(errors).length) return
    this.loading.set(true)
    try {
      const destination = await this.state.authenticate(this.email.trim(), this.password)
      this.state.showToast(`Sesión iniciada como ${destination}.`)
    } catch (error) {
      this.loginError.set(error instanceof Error ? error.message : "Correo o contraseña incorrectos.")
    } finally {
      this.loading.set(false)
    }
  }
}

import { Injectable, signal } from "@angular/core"
import {
  checkBackendHealth,
  codimacAuth,
  savePreferences,
} from "../../lib/codimac-api"
import { roleNavigation } from "./models"
import type { DialogKind, Role } from "./models"

export type ToastTone = "success" | "error" | "info"

@Injectable({ providedIn: "root" })
export class AppStateService {
  readonly role = signal<Role>(this.readRole())
  readonly active = signal(roleNavigation[this.role()][0].label)
  readonly userName = signal("")
  readonly userId = signal("")
  readonly menuOpen = signal(false)
  readonly isOnline = signal(false)
  readonly toast = signal("")
  readonly toastTone = signal<ToastTone>("success")
  readonly dialog = signal<DialogKind | null>(null)
  readonly inventoryRefresh = signal(0)
  readonly catalogRefresh = signal(0)
  readonly ordersRefresh = signal(0)
  /** Texto que la búsqueda global entrega a la lista de pedidos. */
  readonly globalSearch = signal("")
  /** Id del registro recién creado o editado; las listas lo resaltan unos segundos (patrón "Lista actualizada"). */
  readonly highlightedId = signal("")

  private toastTimer: number | undefined
  private highlightTimer: number | undefined

  constructor() {
    void this.restoreSession()
    const { data } = codimacAuth.onAuthStateChange((event, session) => {
      this.isOnline.set(Boolean(session))
      if (event === "SESSION_EXPIRED" && this.role() !== "Acceso" && this.role() !== "Cliente") {
        this.dialog.set(null)
        this.changeRole("Acceso")
        this.userName.set("")
        this.userId.set("")
        this.showToast("Tu sesión expiró. Inicia sesión nuevamente.", "info", 5000)
      }
    })
    window.addEventListener("beforeunload", () =>
      data.subscription.unsubscribe(),
      { once: true },
    )
  }

  changeRole(role: Role): void {
    this.role.set(role)
    this.active.set(roleNavigation[role][0].label)
    this.menuOpen.set(false)
    this.persistPreferences()
  }

  selectSection(section: string): void {
    if (!roleNavigation[this.role()].some((item) => item.label === section)) {
      this.showToast("No tienes acceso a esta sección.", "error")
      return
    }
    this.active.set(section)
    this.menuOpen.set(false)
    this.persistPreferences()
  }

  /** Aviso de unos 4 segundos sobre el fondo difuminado (sección 7: aviso de éxito). */
  showToast(message: string, tone: ToastTone = "success", duration = 4000): void {
    this.toast.set(message)
    this.toastTone.set(tone)
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toast.set(""), duration)
  }

  showError(error: unknown, fallback: string): void {
    this.showToast(error instanceof Error ? error.message : fallback, "error", 6000)
  }

  openDialog(kind: DialogKind): void {
    this.dialog.set(kind)
  }

  highlight(id: string): void {
    this.highlightedId.set(id)
    if (this.highlightTimer !== undefined) window.clearTimeout(this.highlightTimer)
    this.highlightTimer = window.setTimeout(() => this.highlightedId.set(""), 4000)
  }

  searchOrders(query: string): void {
    this.globalSearch.set(query.trim())
    this.selectSection("Pedidos")
  }

  async authenticate(email: string, password: string): Promise<Role> {
    await checkBackendHealth()
    const { data, error } = await codimacAuth.signInWithPassword({ email, password })
    if (error || !data.user) throw error ?? new Error("No se pudo iniciar sesión.")
    const metadataRole = data.user.user_metadata["role"]
    if (!this.isRole(metadataRole)) throw new Error("El servidor devolvió un rol inválido.")
    this.userName.set(data.user.user_metadata.name)
    this.userId.set(data.user.id)
    this.isOnline.set(true)
    this.changeRole(metadataRole)
    return metadataRole
  }

  async logout(): Promise<void> {
    const { error } = await codimacAuth.signOut()
    this.isOnline.set(false)
    this.changeRole("Acceso")
    this.userName.set("")
    this.userId.set("")
    this.showToast("Sesión cerrada correctamente.", "info")
    if (error) throw error
  }

  private async restoreSession(): Promise<void> {
    try {
      const { data } = await codimacAuth.getSession()
      if (!data.session) {
        this.isOnline.set(false)
        return
      }
      const { data: userData } = await codimacAuth.getUser()
      this.isOnline.set(true)
      this.userName.set(userData.user.display_name)
      this.userId.set(userData.user.id)
      if (this.isRole(userData.user.role)) this.changeRole(userData.user.role)
    } catch (error) {
      this.isOnline.set(false)
      await codimacAuth.signOut()
      console.warn("No se pudo restaurar la sesión de CODIMAC.", error)
    }
  }

  private persistPreferences(): void {
    const role = this.role()
    const active = this.active()
    try {
      localStorage.setItem("codimac-role", role)
      localStorage.setItem("codimac-section", active)
    } catch {
      return
    }
    if (!localStorage.getItem("codimac-access-token") || !this.isServerRole(role)) return
    const storedUser = localStorage.getItem("codimac-auth-user")
    try {
      if (!storedUser || JSON.parse(storedUser).role !== role) return
    } catch {
      return
    }
    void savePreferences({ role, active }).catch((error: unknown) => {
      console.warn("No se pudieron sincronizar las preferencias.", error)
    })
  }

  private readRole(): Role {
    return "Acceso"
  }

  private isRole(value: unknown): value is Role {
    return (
      typeof value === "string" &&
      Object.prototype.hasOwnProperty.call(roleNavigation, value)
    )
  }

  private isServerRole(value: Role): value is Exclude<Role, "Cliente" | "Acceso"> {
    return value === "Despachador" || value === "Chofer" || value === "Administrador"
  }
}

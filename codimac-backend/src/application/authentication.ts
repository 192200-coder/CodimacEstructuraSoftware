import { ApplicationError } from "./errors.js"
import {
  registrarEventoAuditoria,
  type RegistroAuditoria,
} from "./registro-auditoria.js"

export interface AuthenticationProfile {
  id: string
  email: string
  display_name: string
  role: "Despachador" | "Chofer" | "Administrador"
  passwordHash: string
  active: boolean
}

export interface AuthenticationTransaction {
  readonly audit: RegistroAuditoria
  createSession(sessionId: string, userId: string): Promise<void>
  removeExpiredSessions(): Promise<void>
}

export interface AuthenticationRepository {
  findProfileByEmail(email: string): Promise<AuthenticationProfile | null>
  transaction<T>(operation: (tx: AuthenticationTransaction) => Promise<T>): Promise<T>
}

export interface PasswordVerifier {
  verify(password: string, passwordHash: string): Promise<boolean>
}

export interface AuthenticationUseCases {
  login(email: string, password: string): Promise<{
    token: string
    user: Omit<AuthenticationProfile, "passwordHash" | "active">
  }>
}

export function createAuthenticationUseCases(
  repository: AuthenticationRepository,
  passwordVerifier: PasswordVerifier,
  newSessionId: () => string,
  issueToken: (userId: string, sessionId: string) => string,
): AuthenticationUseCases {
  return {
    async login(email, password) {
      const profile = await repository.findProfileByEmail(email)
      const validCredentials = profile?.active
        ? await passwordVerifier.verify(password, profile.passwordHash)
        : false
      if (!profile || !validCredentials) {
        const reason = !profile
          ? "Cuenta no encontrada"
          : !profile.active
            ? "Cuenta inactiva"
            : "Credenciales incorrectas"
        await repository.transaction(async (tx) => {
          await registrarEventoAuditoria(tx.audit, {
            usuarioId: profile?.id ?? null,
            accion: "Inicio de sesión fallido",
            entidad: "Autenticación",
            entidadId: profile?.id ?? null,
            valorAnterior: null,
            valorNuevo: { correoIngresado: email, motivo: reason },
          })
        })
        throw new ApplicationError("UNAUTHENTICATED", "Correo o contraseña incorrectos")
      }

      const user = {
        id: profile.id,
        email: profile.email,
        display_name: profile.display_name,
        role: profile.role,
      }
      const sessionId = newSessionId()
      await repository.transaction(async (tx) => {
        await tx.createSession(sessionId, user.id)
        await tx.removeExpiredSessions()
      })
      return { token: issueToken(user.id, sessionId), user }
    },
  }
}

import { describe, expect, it, vi } from "vitest"
import { createAuthenticationUseCases, type AuthenticationRepository } from "./authentication.js"

function createRepository(audit: ReturnType<typeof vi.fn>): AuthenticationRepository {
  return {
    findProfileByEmail: vi.fn(async () => null),
    transaction: vi.fn(async (operation) => operation({
      audit: { registrar: audit },
      createSession: vi.fn(async () => undefined),
      removeExpiredSessions: vi.fn(async () => undefined),
    })),
  }
}

describe("caso de uso de autenticación", () => {
  it("registra fallos de inicio de sesión desde el caso de uso", async () => {
    const audit = vi.fn(async () => undefined)
    const repository = createRepository(audit)
    const useCases = createAuthenticationUseCases(
      repository,
      { verify: vi.fn(async () => false) },
      () => "session-id",
      () => "token",
    )

    await expect(useCases.login("missing@example.com", "bad-password"))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" })

    expect(audit).toHaveBeenCalledWith({
      usuarioId: null,
      accion: "Inicio de sesión fallido",
      entidad: "Autenticación",
      entidadId: null,
      valorAnterior: null,
      valorNuevo: {
        correoIngresado: "missing@example.com",
        motivo: "Cuenta no encontrada",
      },
    })
  })

  it("crea sesión y token para credenciales válidas sin auditar un fallo", async () => {
    const audit = vi.fn(async () => undefined)
    const repository = createRepository(audit)
    vi.mocked(repository.findProfileByEmail).mockResolvedValue({
      id: "profile-1",
      email: "user@example.com",
      display_name: "Usuario",
      role: "Administrador",
      passwordHash: "hash",
      active: true,
    })
    const useCases = createAuthenticationUseCases(
      repository,
      { verify: vi.fn(async () => true) },
      () => "session-id",
      (userId, sessionId) => `${userId}:${sessionId}`,
    )

    await expect(useCases.login("user@example.com", "password")).resolves.toEqual({
      token: "profile-1:session-id",
      user: {
        id: "profile-1",
        email: "user@example.com",
        display_name: "Usuario",
        role: "Administrador",
      },
    })
    expect(audit).not.toHaveBeenCalled()
  })
})

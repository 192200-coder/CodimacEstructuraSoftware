import { describe, expect, it, vi } from "vitest"
import { registrarEventoAuditoria } from "../application/registro-auditoria.js"
import { PostgresRegistroAuditoria } from "./postgres-registro-auditoria.js"

describe("adaptador PostgreSQL de auditoría", () => {
  it("persiste un evento estructurado sin descartar valores anteriores o nuevos", async () => {
    const query = vi.fn(async (_text: string, _values: unknown[]) => undefined)
    const registro = new PostgresRegistroAuditoria(query)

    await registrarEventoAuditoria(registro, {
      usuarioId: "90000000-0000-4000-8000-000000000001",
      accion: "Cambio de estado",
      entidad: "Pedido",
      entidadId: "40000000-0000-4000-8000-000000000001",
      valorAnterior: { estado: "Pendiente" },
      valorNuevo: { estado: "En preparación" },
    })

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO auditoria_eventos"),
      [
        "90000000-0000-4000-8000-000000000001",
        "Cambio de estado",
        "Pedido",
        "40000000-0000-4000-8000-000000000001",
        JSON.stringify({ estado: "Pendiente" }),
        JSON.stringify({ estado: "En preparación" }),
      ],
    )
  })

  it("admite actor nulo para un intento fallido con una cuenta inexistente", async () => {
    const query = vi.fn(async (_text: string, _values: unknown[]) => undefined)
    const registro = new PostgresRegistroAuditoria(query)

    await registro.registrar({
      usuarioId: null,
      accion: "Inicio de sesión fallido",
      entidad: "Autenticación",
      entidadId: null,
      valorAnterior: null,
      valorNuevo: { correoIngresado: "desconocido@codimac.pe" },
    })

    expect(query.mock.calls[0]?.[1]).toEqual([
      null,
      "Inicio de sesión fallido",
      "Autenticación",
      null,
      null,
      JSON.stringify({ correoIngresado: "desconocido@codimac.pe" }),
    ])
  })
})

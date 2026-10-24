import { describe, expect, it, vi } from "vitest"
import { GoogleRoutesMatrix } from "../adapters/google-routes-matrix.js"
import { createRouteMatrixUseCase, type ServicioMapas } from "./route-matrix.js"

const puntos = [
  { latitude: -13.6366, longitude: -72.8814 },
  { latitude: -13.62, longitude: -72.865 },
]
const ids = ["almacen", "order-1"]

describe("matriz de tiempos y distancias (RF-02.1, RF-02.7)", () => {
  it("sin proveedor configurado usa el estimador local y lo indica", async () => {
    const matriz = await createRouteMatrixUseCase().obtenerMatriz(ids, puntos)

    expect(matriz.proveedor).toBe("Estimador local")
    expect(matriz.usaTraficoReal).toBe(false)
    expect(matriz.minutos).toBeNull()
    expect(matriz.distanciasKm[0]![1]).toBeGreaterThan(0)
    expect(matriz.aviso).toBe("Ruta calculada con estimación local, sin tráfico real.")
  })

  it("E-18: si el proveedor cae, sigue con el estimador local y registra la falla", async () => {
    const logger = { warn: vi.fn() }
    const proveedor: ServicioMapas = {
      nombre: "Google Routes",
      calcularMatriz: vi.fn(async () => { throw new Error("timeout") }),
    }
    const matriz = await createRouteMatrixUseCase({ proveedor, logger }).obtenerMatriz(ids, puntos)

    expect(matriz.usaTraficoReal).toBe(false)
    expect(matriz.aviso).toContain("sin tráfico real")
    expect(logger.warn).toHaveBeenCalledWith("mapas.proveedor_fallido", { proveedor: "Google Routes", error: "timeout" })
  })

  it("con proveedor usa sus tiempos con tráfico y los guarda en caché (RNF-10)", async () => {
    const proveedor: ServicioMapas = {
      nombre: "Google Routes",
      calcularMatriz: vi.fn(async () => ({ distanciasKm: [[0, 4.2], [4.1, 0]], minutos: [[0, 12], [11, 0]] })),
    }
    const useCase = createRouteMatrixUseCase({ proveedor })
    const first = await useCase.obtenerMatriz(ids, puntos)
    await useCase.obtenerMatriz(ids, puntos)

    expect(first).toMatchObject({ usaTraficoReal: true, proveedor: "Google Routes", minutos: [[0, 12], [11, 0]] })
    expect(proveedor.calcularMatriz).toHaveBeenCalledTimes(1)
  })
})

describe("adaptador Google Routes", () => {
  it("convierte la respuesta de computeRouteMatrix en km y minutos", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { originIndex: 0, destinationIndex: 1, distanceMeters: 4200, duration: "720s", condition: "ROUTE_EXISTS" },
      { originIndex: 1, destinationIndex: 0, distanceMeters: 4100, duration: "660s", condition: "ROUTE_EXISTS" },
      { originIndex: 0, destinationIndex: 0, distanceMeters: 0, duration: "0s", condition: "ROUTE_EXISTS" },
      { originIndex: 1, destinationIndex: 1, distanceMeters: 0, duration: "0s", condition: "ROUTE_EXISTS" },
    ])))
    const adapter = new GoogleRoutesMatrix("clave", fetchImpl as unknown as typeof fetch)

    await expect(adapter.calcularMatriz(puntos)).resolves.toEqual({
      distanciasKm: [[0, 4.2], [4.1, 0]],
      minutos: [[0, 12], [11, 0]],
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("clave")
  })

  it("reintenta una vez y luego informa el error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }))
    const adapter = new GoogleRoutesMatrix("clave", fetchImpl as unknown as typeof fetch)

    await expect(adapter.calcularMatriz(puntos)).rejects.toThrow("Google Routes respondió 503")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

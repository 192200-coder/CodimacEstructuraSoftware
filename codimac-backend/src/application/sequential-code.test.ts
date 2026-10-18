import { describe, expect, it } from "vitest"
import { formatSequentialCode } from "./sequential-code.js"

describe("formato de códigos secuenciales", () => {
  it("formatea pedidos con cuatro dígitos y amplía el código después de 9999", () => {
    expect(formatSequentialCode("PED", 1)).toBe("PED-0001")
    expect(formatSequentialCode("PED", 9999)).toBe("PED-9999")
    expect(formatSequentialCode("PED", 10000)).toBe("PED-10000")
  })

  it("formatea repartos con tres dígitos y valida el secuencial", () => {
    expect(formatSequentialCode("R", 1)).toBe("R-001")
    expect(formatSequentialCode("R", 1000)).toBe("R-1000")
    expect(() => formatSequentialCode("R", 0)).toThrow(RangeError)
  })
})

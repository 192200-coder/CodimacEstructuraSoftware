import { describe, expect, it } from "vitest"
import { matchesCodeSearch } from "./busqueda-codigo"

describe("búsqueda tolerante de códigos", () => {
  it.each(["42", "0042", "ped-0042", "PED-0042"])(
    "encuentra PED-0042 con la consulta %s",
    (query) => {
      expect(matchesCodeSearch("PED-0042", query)).toBe(true)
    },
  )

  it("ignora ceros iniciales al buscar códigos de reparto", () => {
    expect(matchesCodeSearch("R-001", "1")).toBe(true)
    expect(matchesCodeSearch("R-001", "r-001")).toBe(true)
    expect(matchesCodeSearch("R-001", "PED-001")).toBe(false)
  })
})

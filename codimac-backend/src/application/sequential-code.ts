export function formatSequentialCode(prefix: "PED" | "R", value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("El número secuencial debe ser un entero positivo seguro.")
  }
  const minimumDigits = prefix === "PED" ? 4 : 3
  return `${prefix}-${String(value).padStart(minimumDigits, "0")}`
}

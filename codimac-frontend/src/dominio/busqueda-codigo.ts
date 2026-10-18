export function matchesCodeSearch(code: string, query: string): boolean {
  const normalizedCode = code.trim().toLocaleUpperCase("es-PE")
  const normalizedQuery = query.trim().toLocaleUpperCase("es-PE")
  if (!normalizedQuery) return true
  if (normalizedCode.includes(normalizedQuery)) return true

  const codeParts = /^([A-Z]+)-(\d+)$/.exec(normalizedCode)
  const queryParts = /^(?:([A-Z]+)-)?(\d+)$/.exec(normalizedQuery)
  if (!codeParts || !queryParts) return false

  const [, codePrefix, codeNumber] = codeParts
  const [, queryPrefix, queryNumber] = queryParts
  if (queryPrefix && queryPrefix !== codePrefix) return false
  return Number(codeNumber) === Number(queryNumber)
}

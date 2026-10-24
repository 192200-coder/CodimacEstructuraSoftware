// RNF-16: logs estructurados (una línea JSON por evento), fáciles de filtrar en el servidor.

type Level = "info" | "warn" | "error"
type Sink = (line: string) => void

function write(level: Level, event: string, data: Record<string, unknown>, sink: Sink) {
  sink(JSON.stringify({ time: new Date().toISOString(), level, event, ...data }))
}

export function createLogger(sinks: Partial<Record<Level, Sink>> = {}) {
  const info = sinks.info ?? ((line: string) => console.log(line))
  const warn = sinks.warn ?? ((line: string) => console.warn(line))
  const error = sinks.error ?? ((line: string) => console.error(line))
  return {
    info: (event: string, data: Record<string, unknown> = {}) => write("info", event, data, info),
    warn: (event: string, data: Record<string, unknown> = {}) => write("warn", event, data, warn),
    error: (event: string, data: Record<string, unknown> = {}) => write("error", event, data, error),
  }
}

export type Logger = ReturnType<typeof createLogger>

export const logger = createLogger()

export function errorData(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { error: error.message, stack: error.stack?.split("\n").slice(0, 4).join(" | ") }
    : { error: String(error) }
}

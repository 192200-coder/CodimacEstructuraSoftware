// Localización (RNF-15): español de Perú, zona America/Lima y horas en formato de 24 horas.

export type EstiloFecha = "fecha" | "hora" | "fechaHora"

const opciones: Record<EstiloFecha, Intl.DateTimeFormatOptions> = {
  fecha: { day: "2-digit", month: "2-digit", year: "numeric" },
  hora: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  fechaHora: {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
}

const formateadores = new Map<EstiloFecha, Intl.DateTimeFormat>()

export function formatearFecha(
  valor: string | number | Date | null | undefined,
  estilo: EstiloFecha = "fechaHora",
): string {
  if (valor === null || valor === undefined || valor === "") return "—"
  const fecha = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(fecha.getTime())) return "—"
  let formateador = formateadores.get(estilo)
  if (!formateador) {
    formateador = new Intl.DateTimeFormat("es-PE", { ...opciones[estilo], timeZone: "America/Lima" })
    formateadores.set(estilo, formateador)
  }
  return formateador.format(fecha)
}

/** Saludo según la hora de Lima: días hasta las 11:59, tardes hasta las 18:59. */
export function saludoPorHora(ahora = new Date()): string {
  const hora = Number(new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Lima",
  }).format(ahora))
  if (hora >= 5 && hora < 12) return "Buenos días"
  if (hora >= 12 && hora < 19) return "Buenas tardes"
  return "Buenas noches"
}

export function iniciales(nombre: string): string {
  return nombre
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => parte[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

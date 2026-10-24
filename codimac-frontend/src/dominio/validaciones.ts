// Catálogo de validaciones (Anexo B, especificación v1.1). El backend es la autoridad;
// estas reglas solo ayudan al usuario a corregir antes de enviar (RNF-05, RNF-24).

export type ErroresCampo = Record<string, string>

export const UNIDADES_PRODUCTO = [
  "Unidad",
  "Bolsa de 42,5 kg",
  "Varilla de 9 m",
  "Kilogramo",
  "Metro",
  "Metro cúbico",
  "Galón",
  "Caja",
  "Rollo",
  "Plancha",
] as const

export const TIPOS_VEHICULO = ["Camioneta", "Camión"] as const
export const ROLES_USUARIO = ["Despachador", "Chofer", "Administrador"] as const
export const MOTIVOS_AJUSTE = ["Conteo físico", "Merma o daño", "Corrección de registro", "Otro"] as const
export const CAUSAS_INCIDENCIA = ["Cliente ausente", "Dirección errónea", "Otra"] as const

const CELULAR = /^9\d{8}$/
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PLACA = /^[A-Z0-9]{3}-\d{3}$/

const largo = (valor: string | null | undefined) => (valor ?? "").trim().length

function numero(valor: unknown): number {
  if (valor === "" || valor === null || valor === undefined) return Number.NaN
  return Number(valor)
}

function entero(valor: unknown, min: number, max = Number.POSITIVE_INFINITY): boolean {
  const n = numero(valor)
  return Number.isInteger(n) && n >= min && n <= max
}

function decimales(valor: number, maximo: number): boolean {
  const escalado = valor * 10 ** maximo
  return Math.abs(escalado - Math.round(escalado)) < 1e-6
}

/** Quita las claves sin mensaje para que `Object.keys(errores).length` indique si hay errores. */
function limpiar(errores: Record<string, string | null>): ErroresCampo {
  return Object.fromEntries(
    Object.entries(errores).filter((entrada): entrada is [string, string] => Boolean(entrada[1])),
  )
}

export function mensajeCelular(valor: string): string | null {
  return CELULAR.test(valor.trim()) ? null : "Ingresa un celular de 9 dígitos que empiece con 9."
}

export function mensajeContrasena(valor: string): string | null {
  return valor.length >= 8 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(valor) && /\d/.test(valor)
    ? null
    : "Mínimo 8 caracteres, con letras y números."
}

export function validarUsuario(
  usuario: { name: string; email: string; password: string; role: string; phone?: string },
  opciones: { creando: boolean },
): ErroresCampo {
  const phone = usuario.phone?.trim() ?? ""
  return limpiar({
    name: largo(usuario.name) >= 3 && largo(usuario.name) <= 80 ? null : "Ingresa el nombre completo.",
    email: opciones.creando && !CORREO.test(usuario.email.trim()) ? "Ingresa un correo válido." : null,
    password: opciones.creando || usuario.password ? mensajeContrasena(usuario.password) : null,
    role: (ROLES_USUARIO as readonly string[]).includes(usuario.role) ? null : "Elige un rol.",
    phone: phone ? mensajeCelular(phone) : null,
  })
}

export function validarProducto(producto: {
  name: string
  unit: string
  weightKg: unknown
  totalStock?: unknown
}): ErroresCampo {
  const peso = numero(producto.weightKg)
  return limpiar({
    name: largo(producto.name) >= 2 && largo(producto.name) <= 80 ? null : "Ingresa el nombre del producto.",
    unit: largo(producto.unit) ? null : "Elige la unidad.",
    weightKg: !(peso > 0)
      ? "El peso debe ser mayor que 0."
      : decimales(peso, 3) ? null : "Usa como máximo 3 decimales.",
    totalStock: producto.totalStock === undefined || entero(producto.totalStock, 0)
      ? null
      : "Ingresa un número entero, 0 o más.",
  })
}

/** Normaliza la placa para que "abc-123" se guarde como "ABC-123". */
export function normalizarPlaca(placa: string): string {
  return placa.trim().toUpperCase()
}

export function validarVehiculo(vehiculo: {
  plate: string
  vehicleType: string
  capacityKg: unknown
  averageSpeedKmh: unknown
  fuelEfficiencyKmL: unknown
}): ErroresCampo {
  const capacidad = numero(vehiculo.capacityKg)
  const velocidad = numero(vehiculo.averageSpeedKmh)
  const rendimiento = numero(vehiculo.fuelEfficiencyKmL)
  return limpiar({
    plate: PLACA.test(normalizarPlaca(vehiculo.plate)) ? null : "Usa el formato ABC-123.",
    vehicleType: largo(vehiculo.vehicleType) ? null : "Elige el tipo de vehículo.",
    capacityKg: capacidad > 0 ? null : "La capacidad debe ser mayor que 0.",
    averageSpeedKmh: velocidad >= 5 && velocidad <= 120 ? null : "Ingresa una velocidad entre 5 y 120 km/h.",
    fuelEfficiencyKmL: rendimiento > 0 && rendimiento <= 50 ? null : "Ingresa un rendimiento válido en km/L.",
  })
}

export function validarCliente(cliente: {
  name: string
  contact: string
  address: string
  reference: string
  latitude: number | null
  longitude: number | null
}): ErroresCampo {
  const ubicacionValida =
    cliente.latitude !== null &&
    cliente.longitude !== null &&
    Number.isFinite(cliente.latitude) &&
    Number.isFinite(cliente.longitude) &&
    Math.abs(cliente.latitude) <= 90 &&
    Math.abs(cliente.longitude) <= 180
  return limpiar({
    name: largo(cliente.name) >= 2 && largo(cliente.name) <= 100 ? null : "Ingresa el nombre del cliente.",
    contact: mensajeCelular(cliente.contact),
    address: largo(cliente.address) >= 5 && largo(cliente.address) <= 150 ? null : "Ingresa la dirección.",
    reference: largo(cliente.reference) <= 150 ? null : "Máximo 150 caracteres.",
    location: ubicacionValida ? null : "Marca la ubicación en el mapa.",
  })
}

/** Fecha y hora local (`datetime-local`) del inicio de hoy en el navegador, para el atributo min. */
export function inicioDeHoyLocal(ahora = new Date()): string {
  const pad = (valor: number) => String(valor).padStart(2, "0")
  return `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}T00:00`
}

export function validarPedido(
  pedido: {
    clientId: string
    deadlineAt: string
    items: Array<{ productId: string; quantity: unknown }>
  },
  disponibilidad: (productId: string) => { disponible: number; nombre: string } | null,
  ahora = new Date(),
): ErroresCampo {
  const errores: Record<string, string | null> = {
    clientId: pedido.clientId ? null : "Elige un cliente.",
    items: pedido.items.length ? null : "Agrega al menos un producto.",
  }
  if (pedido.deadlineAt) {
    const limite = new Date(pedido.deadlineAt)
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
    errores["deadlineAt"] = Number.isNaN(limite.getTime())
      ? "Ingresa una fecha límite válida."
      : limite < hoy ? "La fecha límite no puede ser anterior a hoy." : null
  }
  const vistos = new Set<string>()
  pedido.items.forEach((item, indice) => {
    if (!item.productId) {
      errores[`lineas[${indice}].producto`] = "Elige un producto."
      return
    }
    if (vistos.has(item.productId)) {
      errores[`lineas[${indice}].producto`] = "Este producto ya está en el pedido."
    }
    vistos.add(item.productId)
    if (!entero(item.quantity, 1)) {
      errores[`lineas[${indice}].cantidad`] = "La cantidad debe ser un número entero, 1 o más."
      return
    }
    const stock = disponibilidad(item.productId)
    const cantidad = numero(item.quantity)
    if (stock && cantidad > stock.disponible) {
      errores[`lineas[${indice}].cantidad`] =
        `Solo hay ${stock.disponible} unidades disponibles de ${stock.nombre}; faltan ${cantidad - stock.disponible}.`
    }
  })
  return limpiar(errores)
}

export function validarMovimientoInventario(movimiento: {
  tipo: "Entrada" | "Ajuste"
  productId: string
  quantity: unknown
  direction?: "Aumentar" | "Disminuir" | ""
  reason?: string
  detail?: string
  existencias?: number
  reservadas?: number
}): ErroresCampo {
  const cantidad = numero(movimiento.quantity)
  const errores: Record<string, string | null> = {
    productId: movimiento.productId ? null : "Elige un producto.",
    quantity: entero(movimiento.quantity, 1) ? null : "Ingresa un número entero, 1 o más.",
  }
  if (movimiento.tipo === "Ajuste") {
    errores["direction"] = movimiento.direction ? null : "Elige si aumentas o disminuyes."
    errores["reason"] = movimiento.reason ? null : "Elige el motivo del ajuste."
    if (movimiento.reason === "Otro") {
      const detalle = largo(movimiento.detail)
      errores["detail"] = detalle >= 5 && detalle <= 120 ? null : "Describe el motivo con 5 a 120 caracteres."
    }
    if (
      !errores["quantity"] &&
      movimiento.direction === "Disminuir" &&
      movimiento.existencias !== undefined &&
      movimiento.reservadas !== undefined &&
      movimiento.existencias - cantidad < movimiento.reservadas
    ) {
      errores["quantity"] = `No puedes bajar de ${movimiento.reservadas} unidades: están reservadas.`
    }
  }
  return limpiar(errores)
}

export function validarParametros(parametros: {
  fuelPrice: unknown
  minutesPerStop: unknown
  serviceRadiusKm: unknown
  warehouseLatitude: unknown
  warehouseLongitude: unknown
}): ErroresCampo {
  const precio = numero(parametros.fuelPrice)
  const latitud = numero(parametros.warehouseLatitude)
  const longitud = numero(parametros.warehouseLongitude)
  return limpiar({
    fuelPrice: !(precio > 0)
      ? "Ingresa un precio mayor que 0."
      : decimales(precio, 2) ? null : "Usa como máximo 2 decimales.",
    minutesPerStop: entero(parametros.minutesPerStop, 0, 120) ? null : "Ingresa un valor entre 0 y 120.",
    serviceRadiusKm: entero(parametros.serviceRadiusKm, 1, 500) ? null : "Ingresa un radio entre 1 y 500 km.",
    warehouse: Math.abs(latitud) <= 90 && Math.abs(longitud) <= 180
      ? null
      : "Marca la ubicación del almacén.",
  })
}

export function validarEntrega(entrega: { receivedBy: string; observations?: string }): ErroresCampo {
  return limpiar({
    receivedBy: largo(entrega.receivedBy) >= 3 && largo(entrega.receivedBy) <= 80
      ? null
      : "Ingresa quién recibió el pedido.",
    observations: largo(entrega.observations) <= 200 ? null : "Máximo 200 caracteres.",
  })
}

export function validarIncidencia(incidencia: { cause: string; notes: string }): ErroresCampo {
  const notas = largo(incidencia.notes)
  return limpiar({
    cause: (CAUSAS_INCIDENCIA as readonly string[]).includes(incidencia.cause) ? null : "Elige la causa.",
    notes: notas > 200
      ? "Máximo 200 caracteres."
      : incidencia.cause === "Otra" && notas < 5 ? "Describe brevemente lo ocurrido." : null,
  })
}

export function validarConsultaPortal(consulta: { codigo: string; ultimos4: string }): ErroresCampo {
  return limpiar({
    codigo: largo(consulta.codigo) ? null : "Ingresa el código de tu pedido.",
    ultimos4: /^\d{4}$/.test(consulta.ultimos4) ? null : "Ingresa los últimos 4 dígitos de tu teléfono.",
  })
}

export function validarInicioSesion(credenciales: { email: string; password: string }): ErroresCampo {
  return limpiar({
    email: CORREO.test(credenciales.email.trim()) ? null : "Ingresa un correo válido.",
    password: credenciales.password ? null : "Ingresa tu contraseña.",
  })
}

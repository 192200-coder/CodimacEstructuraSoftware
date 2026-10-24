export interface AvisoAsignacion {
  routeId: string
  driverId: string
  vehicleId: string
}

export interface ResultadoAviso {
  canal: "WhatsApp"
  estado: "Enviado" | "Simulado" | "Fallido" | "No configurado"
  detalle: string
}

/** Puerto de notificaciones externas (RNF-20): el dominio no conoce al proveedor. */
export interface NotificadorAsignacion {
  notificarAsignacion(aviso: AvisoAsignacion): Promise<ResultadoAviso>
}

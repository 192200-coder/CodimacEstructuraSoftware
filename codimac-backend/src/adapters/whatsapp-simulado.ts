import type {
  AvisoAsignacion,
  NotificadorAsignacion,
  ResultadoAviso,
} from "../application/notificaciones.js"

/** Adaptador del ejercicio: registra el aviso sin enviarlo (RF-03.6, RNF-20). */
export class WhatsAppSimulado implements NotificadorAsignacion {
  async notificarAsignacion(aviso: AvisoAsignacion): Promise<ResultadoAviso> {
    console.info(`[WhatsApp simulado] Reparto ${aviso.routeId} asignado al chofer ${aviso.driverId}.`)
    return {
      canal: "WhatsApp",
      estado: "Simulado",
      detalle: "Aviso registrado sin envío real: el ejercicio usa un adaptador simulado.",
    }
  }
}

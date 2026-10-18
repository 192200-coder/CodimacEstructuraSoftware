export interface CoordenadasMapa {
  latitude: number
  longitude: number
}

export type CambioUbicacionMapa = (
  coordinates: CoordenadasMapa,
  address?: string,
  error?: string,
) => void

export interface PuertoUbicacionMapa {
  initialize(
    container: HTMLElement,
    addressInput: HTMLInputElement,
    initial: CoordenadasMapa | null,
    onChange: CambioUbicacionMapa,
  ): Promise<() => void>
}

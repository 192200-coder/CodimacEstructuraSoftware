function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
}

export function driverDirectionsUrl(latitude: number, longitude: number): string | null {
  if (!validCoordinates(latitude, longitude)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
}

export function driverMapPreviewUrl(latitude: number, longitude: number): string | null {
  if (!validCoordinates(latitude, longitude)) return null
  const padding = 0.006
  const params = new URLSearchParams({
    bbox: `${longitude - padding},${latitude - padding},${longitude + padding},${latitude + padding}`,
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  })
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`
}

export function clientTelephoneUrl(contact: string | null | undefined): string | null {
  if (!contact) return null
  const digits = contact.replace(/\D/g, "")
  if (!digits) return null
  const nationalNumber = digits.startsWith("51") && digits.length === 11
    ? digits.slice(2)
    : digits
  return `tel:+51${nationalNumber}`
}

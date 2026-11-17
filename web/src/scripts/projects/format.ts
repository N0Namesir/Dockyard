// Textos para el docente a partir de números de la API.

export function cpuText(percent: number): string {
  return percent > 0 && percent < 1 ? 'menos de 1 %' : `${Math.round(percent)} %`
}

export function bytesText(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

export function elapsedText(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `Lleva ${minutes} min ${seconds % 60} s` : `Lleva ${seconds} s`
}

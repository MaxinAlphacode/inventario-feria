const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
})

export function money(value) {
  return cop.format(Number(value) || 0)
}

export function num(value) {
  return new Intl.NumberFormat('es-CO').format(Number(value) || 0)
}

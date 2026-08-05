export const COOKIE_NAME = 'tami_auth'

// La cookie guarda un hash del PIN, no el PIN en texto plano: aunque la
// cookie es httpOnly, igual es visible en DevTools -> Application -> Cookies,
// y el PIN es compartido por todo el equipo.
export async function pinToken(pin) {
  const data = new TextEncoder().encode(`inv_tami:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

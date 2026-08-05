import { SignJWT } from 'jose'

// Firma un JWT que Supabase acepta como sesion valida.
//
// Por que existe esto: la llave "anon" viaja dentro del JS del navegador y los
// archivos estaticos de Next.js se sirven SIN pasar por el PIN. Si las politicas
// RLS confiaran en el rol "anon", cualquiera con la URL podria sacar la llave de
// un chunk y leer/borrar la base saltandose el PIN por completo.
//
// En cambio aca: el PIN se valida en el servidor y recien ahi se emite un token
// con rol "authenticated". Las politicas exigen ese rol, asi que la llave anon
// por si sola no da acceso a nada.

const TOKEN_TTL_SECONDS = 60 * 60 * 12 // 12 h: cubre un dia de feria completo

// Identidad fija: no hay usuarios individuales, todo el equipo comparte el PIN.
const SHARED_SUBJECT = '00000000-0000-0000-0000-000000000001'

export function isJwtSecretConfigured() {
  return Boolean(process.env.SUPABASE_JWT_SECRET)
}

export async function mintSupabaseToken() {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) throw new Error('Falta la variable de entorno SUPABASE_JWT_SECRET.')

  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(SHARED_SUBJECT)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))
}

export { TOKEN_TTL_SECONDS }

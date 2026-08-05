import { mintSupabaseToken, isJwtSecretConfigured } from '@/lib/supabaseToken'

// Solo se llega aca con la cookie del PIN valida (lo garantiza proxy.js).
export async function GET() {
  if (!isJwtSecretConfigured()) {
    return Response.json(
      { error: 'Falta la variable de entorno SUPABASE_JWT_SECRET.' },
      { status: 500 }
    )
  }

  try {
    const token = await mintSupabaseToken()
    return Response.json(
      { token },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 })
  }
}

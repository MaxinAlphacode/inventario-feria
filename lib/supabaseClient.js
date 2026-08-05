import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Si faltan las variables de entorno usamos placeholders para que la app
// igual renderice y pueda mostrar un mensaje claro en vez de reventar.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { realtime: { params: { eventsPerSecond: 10 } } }
)

'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Por que existe todo esto:
//
// La llave anon viaja dentro del JS del navegador, y Next.js sirve sus archivos
// estaticos SIN pasar por el PIN. Si las politicas RLS confiaran en el rol
// "anon", cualquiera con la URL podria sacar esa llave de un chunk y leer o
// borrar la base entera saltandose el PIN.
//
// Entonces: el PIN se valida en el servidor y este emite un JWT con rol
// "authenticated" (/api/token). Las politicas exigen ese rol, asi que la llave
// anon por si sola no da acceso a nada.

// El token no es estado de render: es credencial ambiente del cliente, que es
// un singleton del modulo. La opcion `accessToken` lo consulta en cada request,
// asi renovarlo no obliga a recrear el cliente ni a reconectar los canales.
let currentToken = null

const client = isSupabaseConfigured
  ? createClient(url, anonKey, {
      accessToken: async () => currentToken,
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null

const SupabaseContext = createContext({ supabase: null, status: 'loading', error: null })

export function useSupabase() {
  return useContext(SupabaseContext)
}

export default function SupabaseProvider({ children }) {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'unconfigured')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false

    async function loadToken() {
      try {
        const res = await fetch('/api/token')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(json?.error ?? 'No se pudo iniciar la sesión.')

        currentToken = json.token
        client?.realtime?.setAuth(json.token)
        setStatus('ready')
        setError(null)
      } catch (e) {
        if (cancelled) return
        setError(e.message)
        setStatus('error')
      }
    }

    loadToken()

    // El token dura 12 h; lo renovamos antes por si la feria es de varios dias.
    const id = setInterval(loadToken, 1000 * 60 * 60 * 6)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const value = useMemo(
    // Recien exponemos el cliente cuando ya hay token, para que ninguna pantalla
    // dispare consultas sin sesion (darian 401).
    () => ({ supabase: status === 'ready' ? client : null, status, error }),
    [status, error]
  )

  return <SupabaseContext.Provider value={value}>{children}</SupabaseContext.Provider>
}

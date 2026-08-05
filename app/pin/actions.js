'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { COOKIE_NAME, pinToken } from '@/lib/auth'

export async function submitPin(_prevState, formData) {
  const expected = process.env.APP_PIN

  if (!expected) {
    return {
      error:
        'La app no tiene PIN configurado. Falta la variable de entorno APP_PIN.',
    }
  }

  const pin = String(formData.get('pin') ?? '').trim()
  if (!pin) return { error: 'Escribe el PIN.' }
  if (pin !== expected) return { error: 'PIN incorrecto.' }

  const store = await cookies()
  store.set(COOKIE_NAME, await pinToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 dias: no hay que re-loguearse durante la feria
  })

  redirect('/')
}

export async function logout() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
  redirect('/pin')
}

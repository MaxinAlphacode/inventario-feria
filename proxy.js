import { NextResponse } from 'next/server'
import { COOKIE_NAME, pinToken } from '@/lib/auth'

// En Next.js 16 "middleware" pasa a llamarse "proxy" (mismo comportamiento).
export async function proxy(request) {
  const pin = process.env.APP_PIN

  // Sin PIN configurado no hay forma de validar: mandamos a /pin, que muestra
  // el mensaje de configuracion faltante.
  if (!pin) return redirectToPin(request)

  const expected = await pinToken(pin)
  const current = request.cookies.get(COOKIE_NAME)?.value

  if (current === expected) return NextResponse.next()
  return redirectToPin(request)
}

function redirectToPin(request) {
  const url = request.nextUrl.clone()
  url.pathname = '/pin'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  // Todo queda protegido salvo /pin y los assets estaticos.
  matcher: ['/((?!pin|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)'],
}

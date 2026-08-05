'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { submitPin } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-2xl bg-brand px-6 py-4 text-lg font-semibold text-white shadow-sm transition active:scale-[.98] hover:bg-brand-dark disabled:opacity-60"
    >
      {pending ? 'Entrando…' : 'Entrar'}
    </button>
  )
}

export default function PinPage() {
  const [state, formAction] = useActionState(submitPin, null)

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-3xl">
            🎨
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Inventario Feria</h1>
          <p className="mt-1 text-sm text-muted">
            Ingresa el PIN para entrar
          </p>
        </div>

        <form action={formAction} className="space-y-4">
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="••••"
            className="w-full rounded-2xl border border-line bg-paper px-5 py-4 text-center text-2xl tracking-[.4em] outline-none focus:border-brand"
          />

          {state?.error && (
            <p className="rounded-xl bg-brand-soft px-4 py-3 text-center text-sm font-medium text-brand-dark">
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>
      </div>
    </main>
  )
}

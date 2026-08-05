export default function SetupNotice() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="rounded-2xl bg-paper p-6 shadow-sm">
        <p className="text-3xl">🔌</p>
        <h1 className="mt-3 text-xl font-bold">Falta conectar Supabase</h1>
        <p className="mt-2 text-sm text-muted">
          La app no encuentra las credenciales de la base de datos. Crea un
          archivo <code className="rounded bg-cream px-1">.env.local</code> en la
          raíz del proyecto con:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-cream p-4 text-xs leading-relaxed">
{`NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
APP_PIN=elige-un-pin`}
        </pre>
        <p className="mt-4 text-sm text-muted">
          Los valores están en Supabase → Settings → API. Después de guardarlos
          hay que reiniciar <code className="rounded bg-cream px-1">npm run dev</code>.
        </p>
      </div>
    </main>
  )
}

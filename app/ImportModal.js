'use client'

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSupabase } from './SupabaseProvider'

// El manejo de .xlsx vive en /api/excel/* (servidor): la libreria de Excel no
// funciona de forma confiable en el navegador y pesa ~1MB.
async function downloadFromResponse(res, fallbackName) {
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error ?? 'No se pudo generar el archivo.')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const TABS = [
  { id: 'create', label: 'Crear Productos (Excel)' },
  { id: 'update', label: 'Actualizar Inventario (Excel)' },
]

export default function ImportModal({ open, onClose }) {
  const { supabase } = useSupabase()
  const [tab, setTab] = useState('create')
  const [busy, setBusy] = useState(false)
  const [parsed, setParsed] = useState(null) // { rows, errors, fileName }
  const [result, setResult] = useState(null) // { created, updated } | { error }
  const fileInputRef = useRef(null)

  if (!open) return null

  function reset() {
    setParsed(null)
    setResult(null)
    setBusy(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function switchTab(next) {
    setTab(next)
    reset()
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function downloadCreate() {
    setResult(null)
    setBusy(true)
    try {
      await downloadFromResponse(
        await fetch('/api/excel/plantilla'),
        'plantilla-productos.xlsx'
      )
    } catch (e) {
      setResult({ error: e.message })
    }
    setBusy(false)
  }

  async function downloadCurrent() {
    setResult(null)
    setBusy(true)
    try {
      if (!supabase) throw new Error('Todavía no hay sesión con la base de datos.')
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true })
      if (error) throw new Error(error.message)

      await downloadFromResponse(
        await fetch('/api/excel/inventario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ products: data ?? [] }),
        }),
        'inventario-actual.xlsx'
      )
    } catch (e) {
      setResult({ error: e.message })
    }
    setBusy(false)
  }

  async function handleFile(file) {
    if (!file) return
    setResult(null)
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/excel/parse', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'No se pudo leer el archivo.')
      setParsed({ rows: json.rows, errors: json.errors, fileName: file.name })
    } catch (e) {
      setParsed(null)
      setResult({ error: e.message })
    }
    setBusy(false)
  }

  async function confirmImport() {
    if (!parsed || parsed.rows.length === 0) return
    if (!supabase) return setResult({ error: 'Todavía no hay sesión con la base de datos.' })
    setBusy(true)

    if (tab === 'create') {
      const payload = parsed.rows.map((r) => ({
        name: r.name,
        category: r.category,
        price: r.price,
        cost: r.cost,
        stock: r.stock,
      }))
      const { error } = await supabase.from('products').insert(payload)
      setBusy(false)
      if (error) return setResult({ error: error.message })
      setResult({ created: payload.length })
      setParsed(null)
      return
    }

    // tab === 'update': filas con ID -> upsert (actualiza), sin ID -> insert (alta nueva)
    const withId = parsed.rows.filter((r) => r.id)
    const withoutId = parsed.rows.filter((r) => !r.id)

    const jobs = []
    if (withId.length > 0) {
      jobs.push(
        supabase.from('products').upsert(
          withId.map((r) => ({
            id: r.id,
            name: r.name,
            category: r.category,
            price: r.price,
            cost: r.cost,
            stock: r.stock,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: 'id' }
        )
      )
    }
    if (withoutId.length > 0) {
      jobs.push(
        supabase.from('products').insert(
          withoutId.map((r) => ({
            name: r.name,
            category: r.category,
            price: r.price,
            cost: r.cost,
            stock: r.stock,
          }))
        )
      )
    }

    const results = await Promise.all(jobs)
    setBusy(false)
    const failed = results.find((r) => r.error)
    if (failed) return setResult({ error: failed.error.message })
    setResult({ updated: withId.length, created: withoutId.length })
    setParsed(null)
  }

  // Portal a document.body: si este modal quedara anidado dentro de un
  // ancestro con backdrop-filter/filter/transform (como el header, que usa
  // backdrop-blur), ese ancestro se vuelve el "containing block" de todo lo
  // "fixed" adentro y el overlay se ancla a su caja en vez de a la pantalla.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-paper shadow-xl sm:rounded-3xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-paper px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">Importación Masiva</h2>
            <p className="text-xs text-muted">Gestiona tus productos con Excel.</p>
          </div>
          <button
            onClick={handleClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex border-b border-line px-5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-3 text-sm font-semibold transition ${
                tab === t.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-5 px-5 py-5">
          {tab === 'create' ? (
            <Step
              n={1}
              title="Descargar Plantilla"
              desc="Usa el formato oficial para agregar productos nuevos."
            >
              <button
                onClick={downloadCreate}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark"
              >
                ⬇ Descargar Plantilla Vacía (.xlsx)
              </button>
            </Step>
          ) : (
            <Step
              n={1}
              title="Descargar Inventario Actual"
              desc="Descarga el Excel con el inventario actual para modificar precio, nombre o cantidad."
            >
              <button
                onClick={downloadCurrent}
                disabled={busy}
                className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:text-brand-dark disabled:opacity-60"
              >
                ⬇ Descargar Inventario de Productos (.xlsx)
              </button>
            </Step>
          )}

          <Step
            n={2}
            title={tab === 'create' ? 'Subir Archivo Lleno' : 'Subir Inventario Modificado'}
            desc={
              tab === 'create'
                ? 'Selecciona el archivo Excel con la información de tus productos.'
                : 'Selecciona el Excel exportado con las modificaciones (no cambies la columna ID).'
            }
          >
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center transition hover:border-brand hover:bg-brand-soft/40">
              <span className="text-2xl">📤</span>
              <span className="text-sm font-semibold">
                {parsed ? parsed.fileName : 'Seleccionar archivo .xlsx'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </label>
          </Step>

          {busy && <p className="text-center text-sm text-muted">Procesando…</p>}

          {parsed && (
            <div className="rounded-2xl bg-cream p-4">
              <p className="text-sm font-semibold">
                {parsed.rows.length} fila{parsed.rows.length === 1 ? '' : 's'} lista
                {parsed.rows.length === 1 ? '' : 's'} para{' '}
                {tab === 'create' ? 'crear' : 'importar'}
              </p>
              {parsed.errors.length > 0 && (
                <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-xs text-brand-dark">
                  {parsed.errors.map((e, i) => (
                    <li key={i}>⚠ {e}</li>
                  ))}
                </ul>
              )}
              {parsed.rows.length > 0 && (
                <button
                  onClick={confirmImport}
                  disabled={busy}
                  className="mt-3 w-full rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white transition active:scale-[.98] disabled:opacity-60"
                >
                  {tab === 'create'
                    ? `Crear ${parsed.rows.length} producto${parsed.rows.length === 1 ? '' : 's'}`
                    : `Aplicar cambios`}
                </button>
              )}
            </div>
          )}

          {result?.error && (
            <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm font-medium text-brand-dark">
              {result.error}
            </p>
          )}

          {result && !result.error && (
            <div className="rounded-2xl bg-sell/10 px-4 py-3 text-sm font-semibold text-sell-dark">
              {result.created > 0 && <p>✓ {result.created} producto(s) creado(s)</p>}
              {result.updated > 0 && <p>✓ {result.updated} producto(s) actualizado(s)</p>}
              <button
                onClick={handleClose}
                className="mt-2 rounded-lg bg-sell px-3 py-1.5 text-xs font-bold text-white"
              >
                Listo
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function Step({ n, title, desc, children }) {
  return (
    <div className="rounded-2xl bg-cream/60 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">Paso {n}</p>
      <h3 className="mt-0.5 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted">{desc}</p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

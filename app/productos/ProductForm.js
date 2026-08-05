'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import AppHeader from '../AppHeader'
import { useSupabase } from '../SupabaseProvider'
import { money } from '@/lib/format'

const EMPTY = { name: '', category: '', price: '', cost: '', stock: '' }

export default function ProductForm({ productId = null }) {
  const router = useRouter()
  const { supabase } = useSupabase()
  const isEdit = Boolean(productId)

  const [form, setForm] = useState(EMPTY)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('products')
      .select('category')
      .not('category', 'is', null)
      .then(({ data }) => {
        const unique = [...new Set((data ?? []).map((r) => r.category).filter(Boolean))]
        setCategories(unique.sort((a, b) => a.localeCompare(b, 'es')))
      })
  }, [supabase])

  useEffect(() => {
    if (!isEdit || !supabase) return
    supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (!data) setError('Ese producto ya no existe.')
        else
          setForm({
            name: data.name ?? '',
            category: data.category ?? '',
            price: String(Number(data.price)),
            cost: String(Number(data.cost)),
            stock: String(data.stock),
          })
        setLoading(false)
      })
  }, [isEdit, productId, supabase])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const profit = useMemo(
    () => (Number(form.price) || 0) - (Number(form.cost) || 0),
    [form.price, form.cost]
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!supabase) return setError('Todavía no hay sesión con la base de datos.')

    const name = form.name.trim()
    if (!name) return setError('El nombre es obligatorio.')

    const price = Number(form.price) || 0
    const cost = Number(form.cost) || 0
    const stock = Math.trunc(Number(form.stock) || 0)

    if (price < 0 || cost < 0) return setError('Los valores no pueden ser negativos.')
    if (stock < 0) return setError('La cantidad no puede ser negativa.')

    const payload = {
      name,
      category: form.category.trim() || null,
      price,
      cost,
      stock,
    }

    setSaving(true)
    const { error: dbError } = isEdit
      ? await supabase
          .from('products')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', productId)
      : await supabase.from('products').insert(payload)
    setSaving(false)

    if (dbError) return setError(dbError.message)
    router.push('/')
    router.refresh()
  }

  async function handleDelete() {
    if (!supabase) return setError('Todavía no hay sesión con la base de datos.')
    const ok = window.confirm(
      `¿Borrar "${form.name}" del inventario?\n\nLas ventas que ya se registraron se conservan en los reportes.`
    )
    if (!ok) return

    setDeleting(true)
    const { error: dbError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
    setDeleting(false)

    if (dbError) return setError(dbError.message)
    router.push('/')
    router.refresh()
  }

  return (
    <>
      <AppHeader />

      <main className="mx-auto w-full max-w-lg flex-1 px-4 pb-16 pt-4">
        <div className="mb-4 flex items-center gap-3">
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-paper text-muted shadow-sm transition hover:text-ink"
            aria-label="Volver"
          >
            ←
          </Link>
          <h1 className="text-xl font-bold">
            {isEdit ? 'Editar producto' : 'Nuevo producto'}
          </h1>
        </div>

        {loading ? (
          <div className="h-96 animate-pulse rounded-2xl bg-paper" />
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl bg-paper p-5 shadow-sm"
          >
            <Field label="Nombre" hint="Ej: Sticker gato astronauta">
              <input
                value={form.name}
                onChange={set('name')}
                autoFocus={!isEdit}
                className={inputClass}
                placeholder="Nombre del producto"
              />
            </Field>

            <Field label="Categoría" hint="Opcional. Ej: Stickers, Acrílicos, Botones">
              <input
                value={form.category}
                onChange={set('category')}
                list="categorias"
                className={inputClass}
                placeholder="Categoría"
              />
              <datalist id="categorias">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio de venta">
                <input
                  value={form.price}
                  onChange={set('price')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="numeric"
                  className={inputClass}
                  placeholder="0"
                />
              </Field>
              <Field label="Costo">
                <input
                  value={form.cost}
                  onChange={set('cost')}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="numeric"
                  className={inputClass}
                  placeholder="0"
                />
              </Field>
            </div>

            <p
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                profit < 0
                  ? 'bg-brand-soft text-brand-dark'
                  : 'bg-cream text-muted'
              }`}
            >
              Ganancia por unidad:{' '}
              <span className={profit >= 0 ? 'text-ink' : ''}>{money(profit)}</span>
            </p>

            <Field
              label={isEdit ? 'Cantidad disponible' : 'Cantidad inicial'}
              hint={
                isEdit
                  ? 'Ajusta solo si contaste el inventario a mano.'
                  : 'Cuántas unidades tienes para vender.'
              }
            >
              <input
                value={form.stock}
                onChange={set('stock')}
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                className={inputClass}
                placeholder="0"
              />
            </Field>

            {error && (
              <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm font-medium text-brand-dark">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-2xl bg-ink px-6 py-4 text-base font-bold text-white transition active:scale-[.98] disabled:opacity-60"
            >
              {saving ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Agregar al inventario'}
            </button>

            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="w-full rounded-2xl px-6 py-3 text-sm font-semibold text-brand transition hover:bg-brand-soft disabled:opacity-60"
              >
                {deleting ? 'Borrando…' : 'Borrar producto'}
              </button>
            )}
          </form>
        )}
      </main>
    </>
  )
}

const inputClass =
  'w-full rounded-xl border border-line bg-cream px-4 py-3 outline-none focus:border-brand focus:bg-paper'

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

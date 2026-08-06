'use client'

import { useCallback, useEffect, useState } from 'react'
import Modal from './Modal'
import { useSupabase } from './SupabaseProvider'
import { useFair } from './FairProvider'
import { money } from '@/lib/format'

const EMPTY = { name: '', category: '', tiers: [{ qty: 1, price: '' }] }

export default function PromotionsModal({ open, onClose }) {
  const { supabase } = useSupabase()
  const { activeFair, promotions, reloadPromotions } = useFair()

  const [categories, setCategories] = useState([])
  const [draft, setDraft] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadCategories = useCallback(async () => {
    if (!supabase || !activeFair) return
    const { data } = await supabase
      .from('products')
      .select('category')
      .eq('fair_id', activeFair.id)
      .not('category', 'is', null)
    const unique = [...new Set((data ?? []).map((r) => r.category).filter(Boolean))]
    setCategories(unique.sort((a, b) => a.localeCompare(b, 'es')))
  }, [supabase, activeFair])

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCategories()
  }, [open, loadCategories])

  function resetDraft() {
    setDraft(EMPTY)
    setEditingId(null)
    setError(null)
  }

  function editPromo(p) {
    setEditingId(p.id)
    setDraft({
      name: p.name,
      category: p.category,
      tiers: (p.tiers ?? []).map((t) => ({ qty: t.qty, price: String(t.price) })),
    })
    setError(null)
  }

  async function toggle(promo) {
    setBusy(true)
    await supabase.from('promotions').update({ enabled: !promo.enabled }).eq('id', promo.id)
    await reloadPromotions()
    setBusy(false)
  }

  async function remove(promo) {
    if (!window.confirm(`¿Borrar la promoción "${promo.name}"?`)) return
    setBusy(true)
    await supabase.from('promotions').delete().eq('id', promo.id)
    await reloadPromotions()
    if (editingId === promo.id) resetDraft()
    setBusy(false)
  }

  async function save(e) {
    e.preventDefault()
    setError(null)

    if (!draft.name.trim()) return setError('Ponle un nombre a la promoción.')
    if (!draft.category) return setError('Elige la categoría a la que aplica.')

    const tiers = draft.tiers
      .map((t) => ({ qty: Math.trunc(Number(t.qty) || 0), price: Number(t.price) || 0 }))
      .filter((t) => t.qty > 0)
      .sort((a, b) => a.qty - b.qty)

    if (tiers.length === 0) return setError('Agrega al menos un escalón (cantidad y precio).')
    const qtys = tiers.map((t) => t.qty)
    if (new Set(qtys).size !== qtys.length) {
      return setError('Hay dos escalones con la misma cantidad.')
    }

    // Una promocion por categoria: el motor de precios elige una sola.
    const clash = promotions.find(
      (p) => p.category === draft.category && p.id !== editingId
    )
    if (clash) {
      return setError(`Ya existe la promoción "${clash.name}" para ${draft.category}.`)
    }

    setBusy(true)
    const payload = {
      fair_id: activeFair.id,
      name: draft.name.trim(),
      category: draft.category,
      tiers,
    }
    const { error: dbError } = editingId
      ? await supabase.from('promotions').update(payload).eq('id', editingId)
      : await supabase.from('promotions').insert(payload)
    setBusy(false)

    if (dbError) return setError(dbError.message)
    await reloadPromotions()
    resetDraft()
  }

  const setTier = (i, key) => (e) =>
    setDraft((d) => ({
      ...d,
      tiers: d.tiers.map((t, k) => (k === i ? { ...t, [key]: e.target.value } : t)),
    }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Promociones"
      subtitle={activeFair ? `Feria: ${activeFair.name}` : ''}
      size="lg"
    >
      {/* Promociones existentes */}
      {promotions.length > 0 && (
        <ul className="mb-6 space-y-2">
          {promotions.map((p) => (
            <li
              key={p.id}
              className={`rounded-xl border p-3 ${
                p.enabled ? 'border-brand bg-brand-soft' : 'border-line bg-cream'
              }`}
            >
              <div className="flex items-start gap-3">
                <label className="flex cursor-pointer items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() => toggle(p)}
                    disabled={busy}
                    className="h-4 w-4 accent-[#7158a6]"
                    aria-label={`Activar ${p.name}`}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {p.name}{' '}
                    <span className="text-xs font-normal text-muted">· {p.category}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {(p.tiers ?? [])
                      .map((t) => `${t.qty} = ${money(t.price)}`)
                      .join('  ·  ')}
                  </p>
                  {!p.enabled && (
                    <p className="mt-1 text-xs text-muted">Desactivada</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => editPromo(p)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-paper hover:text-ink"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remove(p)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-soft"
                  >
                    Borrar
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Alta / edicion */}
      <form onSubmit={save} className="space-y-3 rounded-xl border border-line p-4">
        <p className="text-sm font-bold">
          {editingId ? 'Editar promoción' : 'Nueva promoción'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-muted">Nombre</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Promoción Stickers"
              className="mt-1 w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-brand focus:bg-paper"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-muted">Categoría</span>
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-brand focus:bg-paper"
            >
              <option value="">Elegir…</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <span className="text-xs font-semibold text-muted">
            Escalones de precio
          </span>
          <div className="mt-1 space-y-2">
            {draft.tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={t.qty}
                  onChange={setTier(i, 'qty')}
                  className="w-20 rounded-lg border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-brand focus:bg-paper"
                />
                <span className="text-sm text-muted">
                  {Number(t.qty) === 1 ? 'unidad en' : 'unidades en'}
                </span>
                <input
                  type="number"
                  min="0"
                  value={t.price}
                  onChange={setTier(i, 'price')}
                  placeholder="0"
                  className="w-32 rounded-lg border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-brand focus:bg-paper"
                />
                {draft.tiers.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({ ...d, tiers: d.tiers.filter((_, k) => k !== i) }))
                    }
                    className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-cream hover:text-danger"
                    aria-label="Quitar escalón"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                tiers: [...d.tiers, { qty: (d.tiers.at(-1)?.qty ?? 0) + 1, price: '' }],
              }))
            }
            className="mt-2 text-xs font-semibold text-brand hover:text-brand-dark"
          >
            + Agregar escalón
          </button>
        </div>

        <p className="rounded-lg bg-cream px-3 py-2 text-xs text-muted">
          Si el cliente lleva más unidades de las que cubre un escalón, la app combina
          escalones y cobra lo más barato posible. Ej: con 1=$3.000 y 2=$5.000, tres
          unidades cuestan $8.000.
        </p>

        {error && (
          <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-60"
          >
            {editingId ? 'Guardar cambios' : 'Crear promoción'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetDraft}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-muted hover:bg-cream"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

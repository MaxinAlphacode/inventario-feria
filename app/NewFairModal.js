'use client'

import { useState } from 'react'
import Modal from './Modal'
import { useSupabase } from './SupabaseProvider'
import { useFair, FAIR_COLORS } from './FairProvider'

export default function NewFairModal({ open, onClose }) {
  const { supabase } = useSupabase()
  const { fairs, activeFair, reloadFairs, setActiveId } = useFair()

  const [name, setName] = useState('')
  const [starts, setStarts] = useState('')
  const [ends, setEnds] = useState('')
  const [color, setColor] = useState('purple')
  const [carryFrom, setCarryFrom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function reset() {
    setName('')
    setStarts('')
    setEnds('')
    setColor('purple')
    setCarryFrom('')
    setError(null)
    setSaving(false)
  }

  function close() {
    reset()
    onClose()
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Ponle un nombre a la feria.')
    if (starts && ends && ends < starts) {
      return setError('La fecha de fin no puede ser anterior a la de inicio.')
    }

    setSaving(true)
    const { data, error: dbError } = await supabase.rpc('start_fair', {
      p_name: name.trim(),
      p_starts: starts || null,
      p_ends: ends || null,
      p_color: color,
      p_carry_from: carryFrom || null,
    })
    setSaving(false)

    if (dbError) return setError(dbError.message)

    await reloadFairs()
    setActiveId(data.id)
    close()
  }

  const carryFair = fairs.find((f) => f.id === carryFrom)

  return (
    <Modal
      open={open}
      onClose={close}
      title="Iniciar nueva feria"
      subtitle="Cada feria tiene su propio inventario, ventas y promociones."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-semibold">Nombre de la feria</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Ej: Friki Fest Neiva"
            className="mt-1.5 w-full rounded-xl border border-line bg-cream px-4 py-2.5 outline-none focus:border-brand focus:bg-paper"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-semibold">Desde</span>
            <input
              type="date"
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-cream px-3 py-2.5 outline-none focus:border-brand focus:bg-paper"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Hasta</span>
            <input
              type="date"
              value={ends}
              min={starts || undefined}
              onChange={(e) => setEnds(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-cream px-3 py-2.5 outline-none focus:border-brand focus:bg-paper"
            />
          </label>
        </div>

        <div>
          <span className="text-sm font-semibold">Color de la tarjeta</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(FAIR_COLORS).map(([key, c]) => (
              <button
                key={key}
                type="button"
                onClick={() => setColor(key)}
                className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm transition ${
                  color === key ? `${c.card} font-semibold` : 'border-line bg-paper text-muted'
                }`}
              >
                <span className={`h-3 w-3 rounded-full ${c.dot}`} />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-sm font-semibold">¿Con qué inventario arranca?</span>
          <div className="mt-2 space-y-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:border-brand">
              <input
                type="radio"
                name="inv"
                checked={carryFrom === ''}
                onChange={() => setCarryFrom('')}
                className="mt-0.5"
              />
              <span>
                <span className="block text-sm font-semibold">Inventario nuevo</span>
                <span className="block text-xs text-muted">
                  Empieza vacío. Cargas los productos a mano o por Excel.
                </span>
              </span>
            </label>

            {fairs.length > 0 && (
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 transition hover:border-brand">
                <input
                  type="radio"
                  name="inv"
                  checked={carryFrom !== ''}
                  onChange={() => setCarryFrom(activeFair?.id ?? fairs[0].id)}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    Traer lo que quedó de una feria anterior
                  </span>
                  <span className="block text-xs text-muted">
                    Copia los productos con stock disponible. La feria anterior no se toca.
                  </span>
                  {carryFrom !== '' && (
                    <select
                      value={carryFrom}
                      onChange={(e) => setCarryFrom(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-brand"
                    >
                      {fairs.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  )}
                </span>
              </label>
            )}
          </div>
        </div>

        {carryFair && (
          <p className="rounded-xl bg-brand-soft px-4 py-3 text-xs text-brand-dark">
            Se copiarán los productos de <strong>{carryFair.name}</strong> que todavía
            tengan stock, con su stock actual como punto de partida.
          </p>
        )}

        {error && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-brand px-6 py-3 font-bold text-white transition hover:bg-brand-dark active:scale-[.98] disabled:opacity-60"
        >
          {saving ? 'Creando…' : 'Iniciar feria'}
        </button>
      </form>
    </Modal>
  )
}

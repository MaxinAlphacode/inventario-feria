'use client'

import { useState } from 'react'
import NewFairModal from './NewFairModal'
import { useFair, FAIR_COLORS } from './FairProvider'

function formatRange(fair) {
  if (!fair.starts_on) return 'Sin fechas'
  const fmt = (d) =>
    new Date(`${d}T12:00:00`)
      .toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
      .toUpperCase()
  if (!fair.ends_on || fair.ends_on === fair.starts_on) return fmt(fair.starts_on)
  return `${fmt(fair.starts_on)} a ${fmt(fair.ends_on)}`
}

export default function FairSidebar() {
  const { fairs, activeId, setActiveId } = useFair()
  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      {/* Escritorio: columna de tarjetas tipo post-it */}
      <aside className="hidden w-44 shrink-0 lg:block">
        <div className="sticky top-20 space-y-2">
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted">
            Ferias
          </p>

          {fairs.map((fair) => {
            const c = FAIR_COLORS[fair.color] ?? FAIR_COLORS.purple
            const active = fair.id === activeId
            return (
              <button
                key={fair.id}
                onClick={() => setActiveId(fair.id)}
                className={`w-full rounded-xl border-2 px-3 py-2.5 text-left transition ${
                  active
                    ? `${c.card} shadow-sm`
                    : 'border-line bg-paper hover:border-lilac'
                }`}
              >
                <span
                  className={`block truncate text-sm leading-tight ${
                    active ? 'font-bold' : 'font-medium text-muted'
                  }`}
                >
                  {fair.name}
                </span>
                <span className="mt-0.5 block text-[10px] font-medium tracking-wide text-muted">
                  {formatRange(fair)}
                </span>
              </button>
            )
          })}

          <button
            onClick={() => setOpenNew(true)}
            className="flex w-full items-center gap-2 rounded-xl border-2 border-dashed border-lilac px-3 py-2.5 text-left text-sm font-semibold text-brand transition hover:bg-brand-soft"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-xs text-white">
              +
            </span>
            Iniciar Nueva Feria
          </button>
        </div>
      </aside>

      {/* Movil / tablet: fila horizontal desplazable */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {fairs.map((fair) => {
          const c = FAIR_COLORS[fair.color] ?? FAIR_COLORS.purple
          const active = fair.id === activeId
          return (
            <button
              key={fair.id}
              onClick={() => setActiveId(fair.id)}
              className={`shrink-0 rounded-xl border-2 px-3 py-2 text-left transition ${
                active ? c.card : 'border-line bg-paper'
              }`}
            >
              <span
                className={`block max-w-40 truncate text-sm leading-tight ${
                  active ? 'font-bold' : 'font-medium text-muted'
                }`}
              >
                {fair.name}
              </span>
              <span className="block text-[10px] text-muted">{formatRange(fair)}</span>
            </button>
          )
        })}
        <button
          onClick={() => setOpenNew(true)}
          className="shrink-0 rounded-xl border-2 border-dashed border-lilac px-3 py-2 text-sm font-semibold text-brand"
        >
          + Nueva feria
        </button>
      </div>

      <NewFairModal open={openNew} onClose={() => setOpenNew(false)} />
    </>
  )
}

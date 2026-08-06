'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

// Portal a document.body a proposito: dentro de un ancestro con
// backdrop-filter/filter/transform (como el header), ese ancestro se vuelve el
// "containing block" y un overlay fixed se ancla a su caja en vez de a la
// pantalla. Todos los modales pasan por aca para no repetir ese bug.
export default function Modal({ open, onClose, title, subtitle, children, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`max-h-[92vh] w-full ${widths[size]} overflow-y-auto rounded-t-3xl bg-paper shadow-xl sm:rounded-2xl`}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-paper px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

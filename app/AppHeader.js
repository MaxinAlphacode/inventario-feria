'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { logout } from './pin/actions'
import ImportModal from './ImportModal'
import PromotionsModal from './PromotionsModal'
import DeleteFairModal from './DeleteFairModal'
import { useFair } from './FairProvider'

const tabs = [
  { href: '/', label: 'Inventario' },
  { href: '/reportes', label: 'Reportes' },
]

function formatRange(fair) {
  if (!fair?.starts_on) return null
  const fmt = (d) =>
    new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
  if (!fair.ends_on || fair.ends_on === fair.starts_on) return fmt(fair.starts_on)
  return `${fmt(fair.starts_on)} a ${fmt(fair.ends_on)}`
}

export default function AppHeader() {
  const pathname = usePathname()
  const { activeFair } = useFair()

  const [importOpen, setImportOpen] = useState(false)
  const [promosOpen, setPromosOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const range = formatRange(activeFair)

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          {/* El logo se sirve desde /public. Si falta, queda el monograma.
              <img> a proposito: es un asset fijo y chico, y next/image no
              aporta nada aca salvo configuracion. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Koket"
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.nextElementSibling.style.display = 'flex'
            }}
          />
          <span
            style={{ display: 'none' }}
            className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-lilac-soft text-sm font-bold text-brand"
          >
            K
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight sm:text-base">
              {activeFair?.name ?? 'Inventario Feria'}
            </span>
            {range && (
              <span className="block truncate text-[11px] leading-tight text-muted">
                {range}
              </span>
            )}
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 rounded-full bg-cream p-1">
          {tabs.map((tab) => {
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition sm:px-4 ${
                  active ? 'bg-brand text-white' : 'text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-sm font-semibold transition hover:bg-cream"
        >
          <span aria-hidden>📥</span>
          <span className="hidden lg:inline">Importar</span>
        </button>

        {/* Engranaje: promociones y borrar feria */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Configuración"
            aria-expanded={menuOpen}
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
              menuOpen ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-cream'
            }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-line bg-paper py-1 shadow-lg">
              <button
                onClick={() => {
                  setPromosOpen(true)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-cream"
              >
                🏷️ Promociones
              </button>
              <div className="my-1 border-t border-line" />
              <button
                onClick={() => {
                  setDeleteOpen(true)
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-danger hover:bg-danger-soft"
              >
                🗑️ Eliminar feria
              </button>
            </div>
          )}
        </div>

        <form action={logout}>
          <button
            type="submit"
            title="Salir"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-cream hover:text-ink"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PromotionsModal open={promosOpen} onClose={() => setPromosOpen(false)} />
      <DeleteFairModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </header>
  )
}

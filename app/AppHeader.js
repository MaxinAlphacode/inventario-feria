'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { logout } from './pin/actions'
import ImportModal from './ImportModal'

const tabs = [
  { href: '/', label: 'Inventario' },
  { href: '/reportes', label: 'Reportes' },
]

export default function AppHeader() {
  const pathname = usePathname()
  const [importOpen, setImportOpen] = useState(false)

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-base">
            🎨
          </span>
          <span className="hidden sm:inline">Inventario Feria</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1 rounded-full bg-paper p-1 shadow-sm">
          {tabs.map((tab) => {
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-ink text-white'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-1.5 rounded-full bg-paper px-4 py-2.5 text-sm font-semibold shadow-sm transition hover:bg-cream"
        >
          <span aria-hidden>📥</span>
          <span className="hidden sm:inline">Importar</span>
        </button>

        <form action={logout}>
          <button
            type="submit"
            title="Salir"
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition hover:bg-paper hover:text-ink"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </div>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </header>
  )
}

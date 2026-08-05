'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppHeader from '../AppHeader'
import SetupNotice from '../SetupNotice'
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient'
import { money, num } from '@/lib/format'

const RANGES = [
  { id: 'today', label: 'Hoy' },
  { id: 'all', label: 'Toda la feria' },
]

export default function ReportesPage() {
  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [range, setRange] = useState('today')
  // Sin credenciales no hay nada que cargar: arrancamos directo en "listo"
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const [salesRes, productsRes] = await Promise.all([
      supabase.from('sales').select('*').order('sold_at', { ascending: false }),
      supabase.from('products').select('*'),
    ])

    if (salesRes.error || productsRes.error) {
      setError((salesRes.error ?? productsRes.error).message)
    } else {
      setError(null)
      setSales(salesRes.data ?? [])
      setProducts(productsRes.data ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    // load es async: los setState ocurren despues del await, no de forma
    // sincrona dentro del efecto (falso positivo de la regla).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // Se mantiene al dia mientras el resto del equipo vende
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const channel = supabase
      .channel('reportes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const visibleSales = useMemo(() => {
    if (range === 'all') return sales
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return sales.filter((s) => new Date(s.sold_at) >= start)
  }, [sales, range])

  const { rows, totals } = useMemo(() => {
    const byKey = new Map()

    // Todos los productos aparecen, aunque no hayan vendido nada
    for (const p of products) {
      byKey.set(p.id, {
        key: p.id,
        name: p.name,
        category: p.category,
        units: 0,
        revenue: 0,
        cost: 0,
        stock: p.stock,
        deleted: false,
      })
    }

    for (const s of visibleSales) {
      // product_id queda null si el producto fue borrado despues de venderse
      const key = s.product_id ?? `borrado:${s.product_name}`
      let row = byKey.get(key)
      if (!row) {
        row = {
          key,
          name: s.product_name,
          category: s.category,
          units: 0,
          revenue: 0,
          cost: 0,
          stock: null,
          deleted: true,
        }
        byKey.set(key, row)
      }
      row.units += 1
      row.revenue += Number(s.price)
      row.cost += Number(s.cost)
    }

    const rows = [...byKey.values()].sort(
      (a, b) => b.units - a.units || a.name.localeCompare(b.name, 'es')
    )

    const totals = rows.reduce(
      (acc, r) => ({
        units: acc.units + r.units,
        revenue: acc.revenue + r.revenue,
        cost: acc.cost + r.cost,
        stock: acc.stock + (r.stock ?? 0),
      }),
      { units: 0, revenue: 0, cost: 0, stock: 0 }
    )

    return { rows, totals }
  }, [visibleSales, products])

  if (!isSupabaseConfigured) {
    return (
      <>
        <AppHeader />
        <SetupNotice />
      </>
    )
  }

  return (
    <>
      <AppHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Reportes</h1>
          <div className="flex rounded-full bg-paper p-1 shadow-sm">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  range === r.id ? 'bg-ink text-white' : 'text-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-dark">
            No se pudieron cargar los reportes: {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-3">
            <div className="h-44 animate-pulse rounded-2xl bg-paper" />
            <div className="h-24 animate-pulse rounded-2xl bg-paper" />
          </div>
        ) : (
          <>
            {/* Totales */}
            <section className="mb-6 rounded-2xl bg-paper p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {range === 'today' ? 'Hoy' : 'Toda la feria'}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-4">
                <Stat label="Piezas vendidas" value={num(totals.units)} />
                <Stat label="Se vendió" value={money(totals.revenue)} />
                <Stat label="Costó" value={money(totals.cost)} />
                <Stat
                  label="Ganancia"
                  value={money(totals.revenue - totals.cost)}
                  tone={totals.revenue - totals.cost >= 0 ? 'good' : 'bad'}
                />
              </div>

              <div className="mt-4 border-t border-line pt-4">
                <p className="text-sm text-muted">
                  Quedan{' '}
                  <span className="font-bold text-ink">{num(totals.stock)}</span>{' '}
                  piezas en inventario
                </p>
              </div>
            </section>

            {/* Detalle por producto */}
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Por producto
            </h2>

            {rows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
                Todavía no hay nada que mostrar.
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <ReportRow key={row.key} row={row} />
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold leading-tight ${
          tone === 'good' ? 'text-sell' : tone === 'bad' ? 'text-brand' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function ReportRow({ row }) {
  const profit = row.revenue - row.cost

  return (
    <li className="rounded-2xl bg-paper p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="font-semibold">{row.name}</h3>
        {row.category && (
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-muted">
            {row.category}
          </span>
        )}
        {row.deleted && (
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-muted">
            producto borrado
          </span>
        )}
        <span className="ml-auto text-sm text-muted">
          {row.stock === null ? '—' : `quedan ${row.stock}`}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Mini label="Vendidas" value={num(row.units)} />
        <Mini label="Vendió" value={money(row.revenue)} />
        <Mini label="Costó" value={money(row.cost)} />
        <Mini
          label="Ganancia"
          value={money(profit)}
          className={profit > 0 ? 'text-sell' : profit < 0 ? 'text-brand' : ''}
        />
      </div>
    </li>
  )
}

function Mini({ label, value, className = '' }) {
  return (
    <div className="rounded-xl bg-cream px-1 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-bold ${className}`}>{value}</p>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppHeader from '../AppHeader'
import SetupNotice from '../SetupNotice'
import Filters from '../Filters'
import { useSupabase, isSupabaseConfigured } from '../SupabaseProvider'
import { money, num } from '@/lib/format'

const RANGES = [
  { id: 'today', label: 'Hoy' },
  { id: 'all', label: 'Toda la feria' },
]

export default function ReportesPage() {
  const { supabase, status: sessionStatus, error: sessionError } = useSupabase()
  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [range, setRange] = useState('today')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [soldFilter, setSoldFilter] = useState('all') // all | sold | unsold
  // Sin credenciales no hay nada que cargar: arrancamos directo en "listo"
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!supabase) return
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
  }, [supabase])

  useEffect(() => {
    if (!supabase) return
    // load es async: los setState ocurren despues del await, no de forma
    // sincrona dentro del efecto (falso positivo de la regla).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [supabase, load])

  // Se mantiene al dia mientras el resto del equipo vende
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('reportes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, load])

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

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [rows])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.category ?? '').toLowerCase().includes(q)) {
        return false
      }
      if (category !== 'all' && r.category !== category) return false
      if (soldFilter === 'sold' && r.units === 0) return false
      if (soldFilter === 'unsold' && r.units > 0) return false
      return true
    })
  }, [rows, query, category, soldFilter])

  // Los totales de la tabla siguen a los filtros; los de arriba son globales.
  const visibleTotals = useMemo(
    () =>
      visibleRows.reduce(
        (acc, r) => ({
          units: acc.units + r.units,
          revenue: acc.revenue + r.revenue,
          cost: acc.cost + r.cost,
          stock: acc.stock + (r.stock ?? 0),
        }),
        { units: 0, revenue: 0, cost: 0, stock: 0 }
      ),
    [visibleRows]
  )

  if (sessionStatus === 'error') {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
          <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-dark">
            No se pudo iniciar la sesión con la base de datos: {sessionError}
          </p>
        </main>
      </>
    )
  }

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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-4">
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
            <div className="h-24 animate-pulse rounded-xl bg-paper" />
            <div className="h-64 animate-pulse rounded-xl bg-paper" />
          </div>
        ) : (
          <>
            {/* Totales */}
            <section className="mb-4 rounded-xl bg-paper p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {range === 'today' ? 'Hoy' : 'Toda la feria'}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
                <Stat label="Piezas vendidas" value={num(totals.units)} />
                <Stat label="Se vendió" value={money(totals.revenue)} />
                <Stat label="Costó" value={money(totals.cost)} />
                <Stat
                  label="Ganancia"
                  value={money(totals.revenue - totals.cost)}
                  tone={totals.revenue - totals.cost >= 0 ? 'good' : 'bad'}
                />
                <Stat label="Quedan en stock" value={num(totals.stock)} />
              </div>
            </section>

            <Filters
              query={query}
              onQuery={setQuery}
              category={category}
              onCategory={setCategory}
              categories={categories}
              shown={visibleRows.length}
              total={rows.length}
            >
              <select
                value={soldFilter}
                onChange={(e) => setSoldFilter(e.target.value)}
                className="rounded-xl border border-line bg-paper px-3 py-2.5 text-base outline-none focus:border-brand sm:text-sm"
              >
                <option value="all">Todos los productos</option>
                <option value="sold">Solo los que vendieron</option>
                <option value="unsold">Sin ventas</option>
              </select>
            </Filters>

            {visibleRows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
                {rows.length === 0
                  ? 'Todavía no hay nada que mostrar.'
                  : 'Ningún producto coincide con los filtros.'}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl bg-paper shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-2.5 font-semibold">Producto</th>
                      <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">
                        Categoría
                      </th>
                      <th className="px-3 py-2.5 text-center font-semibold">Vendidas</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Vendió</th>
                      <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">
                        Costó
                      </th>
                      <th className="px-3 py-2.5 text-right font-semibold">Ganancia</th>
                      <th className="px-3 py-2.5 text-center font-semibold">Quedan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <ReportRow key={row.key} row={row} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-cream/60 font-bold">
                      <td className="px-3 py-2.5">Total</td>
                      <td className="hidden px-3 py-2.5 sm:table-cell" />
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        {num(visibleTotals.units)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {money(visibleTotals.revenue)}
                      </td>
                      <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                        {money(visibleTotals.cost)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right tabular-nums ${
                          visibleTotals.revenue - visibleTotals.cost >= 0
                            ? 'text-sell'
                            : 'text-brand'
                        }`}
                      >
                        {money(visibleTotals.revenue - visibleTotals.cost)}
                      </td>
                      <td className="px-3 py-2.5 text-center tabular-nums">
                        {num(visibleTotals.stock)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
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
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={`mt-0.5 text-xl font-bold leading-tight ${
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
  const sinVentas = row.units === 0

  return (
    <tr className="border-b border-line last:border-0 hover:bg-cream/50">
      <td className="px-3 py-2">
        <span className={`font-medium ${sinVentas ? 'text-muted' : ''}`}>{row.name}</span>
        {row.deleted && (
          <span className="ml-2 rounded-full bg-cream px-2 py-0.5 text-[10px] font-medium text-muted">
            borrado
          </span>
        )}
        {row.category && (
          <span className="block text-xs text-muted sm:hidden">{row.category}</span>
        )}
      </td>

      <td className="hidden px-3 py-2 sm:table-cell">
        {row.category ? (
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-muted">
            {row.category}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>

      <td className="px-3 py-2 text-center font-semibold tabular-nums">
        {num(row.units)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.revenue)}</td>
      <td className="hidden px-3 py-2 text-right tabular-nums text-muted md:table-cell">
        {money(row.cost)}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold tabular-nums ${
          profit > 0 ? 'text-sell' : profit < 0 ? 'text-brand' : 'text-muted'
        }`}
      >
        {money(profit)}
      </td>
      <td className="px-3 py-2 text-center tabular-nums text-muted">
        {row.stock === null ? '—' : row.stock}
      </td>
    </tr>
  )
}

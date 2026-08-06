'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppHeader from '../AppHeader'
import SetupNotice from '../SetupNotice'
import Filters from '../Filters'
import FairSidebar from '../FairSidebar'
import EditSaleModal from '../EditSaleModal'
import { useSupabase, isSupabaseConfigured } from '../SupabaseProvider'
import { useFair } from '../FairProvider'
import { money, num } from '@/lib/format'

const RANGES = [
  { id: 'today', label: 'Hoy' },
  { id: 'all', label: 'Toda la feria' },
]
const VIEWS = [
  { id: 'productos', label: 'Por producto' },
  { id: 'ventas', label: 'Ventas' },
]

export default function ReportesPage() {
  const { supabase, status: sessionStatus, error: sessionError } = useSupabase()
  const { activeFair } = useFair()

  const [sales, setSales] = useState([])
  const [products, setProducts] = useState([])
  const [range, setRange] = useState('today')
  const [view, setView] = useState('productos')
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [error, setError] = useState(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [soldFilter, setSoldFilter] = useState('all')
  const [editing, setEditing] = useState(null)

  const fairId = activeFair?.id

  const load = useCallback(async () => {
    if (!supabase || !fairId) return
    const [salesRes, productsRes] = await Promise.all([
      supabase.from('sales').select('*').eq('fair_id', fairId).order('sold_at', { ascending: false }),
      supabase.from('products').select('*').eq('fair_id', fairId),
    ])

    if (salesRes.error || productsRes.error) {
      setError((salesRes.error ?? productsRes.error).message)
    } else {
      setError(null)
      setSales(salesRes.data ?? [])
      setProducts(productsRes.data ?? [])
    }
    setLoading(false)
  }, [supabase, fairId])

  useEffect(() => {
    if (!supabase || !fairId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [supabase, fairId, load])

  useEffect(() => {
    if (!supabase || !fairId) return
    const channel = supabase
      .channel(`reportes-${fairId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [supabase, fairId, load])

  const visibleSales = useMemo(() => {
    if (range === 'all') return sales
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return sales.filter((s) => new Date(s.sold_at) >= start)
  }, [sales, range])

  // `charged` es lo realmente cobrado (con promocion). `price` es el de lista.
  const amount = (s) => Number(s.charged ?? s.price ?? 0)

  const { rows, totals } = useMemo(() => {
    const byKey = new Map()

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
        promoUnits: 0,
      })
    }

    for (const s of visibleSales) {
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
          promoUnits: 0,
        }
        byKey.set(key, row)
      }
      row.units += 1
      row.revenue += amount(s)
      row.cost += Number(s.cost)
      if (s.promotion_name) row.promoUnits += 1
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
        promoUnits: acc.promoUnits + r.promoUnits,
      }),
      { units: 0, revenue: 0, cost: 0, stock: 0, promoUnits: 0 }
    )
    return { rows, totals }
  }, [visibleSales, products])

  // Agrupa las filas por unidad en tickets, para la vista de ventas y la edicion.
  const tickets = useMemo(() => {
    const byTicket = new Map()
    for (const s of visibleSales) {
      const id = s.sale_id ?? s.id
      if (!byTicket.has(id)) {
        byTicket.set(id, {
          sale_id: id,
          sold_at: s.sold_at,
          total: 0,
          unidades: 0,
          promos: new Set(),
          itemsMap: new Map(),
        })
      }
      const t = byTicket.get(id)
      t.total += amount(s)
      t.unidades += 1
      if (s.promotion_name) t.promos.add(s.promotion_name)

      const k = s.product_id ?? `borrado:${s.product_name}`
      if (!t.itemsMap.has(k)) {
        t.itemsMap.set(k, {
          product_id: s.product_id,
          product_name: s.product_name,
          category: s.category,
          price: Number(s.price),
          cost: Number(s.cost),
          qty: 0,
          charged: 0,
          promotion_name: s.promotion_name,
        })
      }
      const it = t.itemsMap.get(k)
      it.qty += 1
      it.charged += amount(s)
    }

    return [...byTicket.values()]
      .map((t) => ({
        ...t,
        promos: [...t.promos],
        items: [...t.itemsMap.values()],
      }))
      .sort((a, b) => new Date(b.sold_at) - new Date(a.sold_at))
  }, [visibleSales])

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => r.category).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [rows])

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !(r.category ?? '').toLowerCase().includes(q))
        return false
      if (category !== 'all' && r.category !== category) return false
      if (soldFilter === 'sold' && r.units === 0) return false
      if (soldFilter === 'unsold' && r.units > 0) return false
      if (soldFilter === 'promo' && r.promoUnits === 0) return false
      return true
    })
  }, [rows, query, category, soldFilter])

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
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
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

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-5 px-4 pb-16 pt-4">
        <FairSidebar />

        <main className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-bold">Reportes</h1>
            <div className="flex flex-wrap gap-2">
              <div className="flex rounded-full bg-cream p-1">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      view === v.id ? 'bg-brand text-white' : 'text-muted'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="flex rounded-full bg-cream p-1">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                      range === r.id ? 'bg-brand text-white' : 'text-muted'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
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
                {totals.promoUnits > 0 && (
                  <p className="mt-3 border-t border-line pt-3 text-sm text-muted">
                    🏷️{' '}
                    <span className="font-semibold text-brand">
                      {num(totals.promoUnits)}
                    </span>{' '}
                    de {num(totals.units)} piezas se vendieron con promoción
                  </p>
                )}
              </section>

              {view === 'productos' ? (
                <>
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
                      <option value="promo">Vendidos con promoción</option>
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
                            <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Categoría</th>
                            <th className="px-3 py-2.5 text-center font-semibold">Vendidas</th>
                            <th className="hidden px-3 py-2.5 text-center font-semibold lg:table-cell">
                              En promo
                            </th>
                            <th className="px-3 py-2.5 text-right font-semibold">Vendió</th>
                            <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">Costó</th>
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
                          <tr className="border-t-2 border-line bg-cream/70 font-bold">
                            <td className="px-3 py-2.5">Total</td>
                            <td className="hidden px-3 py-2.5 sm:table-cell" />
                            <td className="px-3 py-2.5 text-center tabular-nums">
                              {num(visibleTotals.units)}
                            </td>
                            <td className="hidden px-3 py-2.5 lg:table-cell" />
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
                                  : 'text-danger'
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
              ) : (
                <TicketList tickets={tickets} onEdit={setEditing} />
              )}
            </>
          )}
        </main>
      </div>

      <EditSaleModal
        open={Boolean(editing)}
        sale={editing}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </>
  )
}

function TicketList({ tickets, onEdit }) {
  if (tickets.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-6 py-10 text-center text-sm text-muted">
        Todavía no hay ventas registradas.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {tickets.map((t) => (
        <li key={t.sale_id} className="rounded-xl bg-paper p-4 shadow-sm">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {new Date(t.sold_at).toLocaleString('es-CO', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
              <p className="text-xs text-muted">
                {t.unidades} pieza{t.unidades === 1 ? '' : 's'}
                {t.promos.length > 0 && (
                  <span className="ml-1 font-semibold text-brand">
                    · 🏷️ {t.promos.join(', ')}
                  </span>
                )}
              </p>
            </div>
            <span className="text-lg font-bold tabular-nums">{money(t.total)}</span>
            <button
              onClick={() => onEdit(t)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition hover:border-brand hover:bg-brand-soft hover:text-brand"
            >
              Editar venta
            </button>
          </div>

          <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
            {t.items.map((i) => (
              <li
                key={i.product_id ?? i.product_name}
                className="flex items-baseline gap-2 text-sm"
              >
                <span className="text-muted tabular-nums">{i.qty}×</span>
                <span className="min-w-0 flex-1 truncate">{i.product_name}</span>
                {i.promotion_name && <span className="text-xs text-brand">🏷️</span>}
                <span className="tabular-nums text-muted">{money(i.charged)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 text-xl font-bold leading-tight ${
          tone === 'good' ? 'text-sell' : tone === 'bad' ? 'text-danger' : ''
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
    <tr className="border-b border-line last:border-0 hover:bg-cream/60">
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
          <span className="rounded-full bg-lilac-soft px-2 py-0.5 text-xs font-medium text-brand">
            {row.category}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-center font-semibold tabular-nums">{num(row.units)}</td>
      <td className="hidden px-3 py-2 text-center tabular-nums lg:table-cell">
        {row.promoUnits > 0 ? (
          <span className="rounded-md bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">
            {row.promoUnits}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{money(row.revenue)}</td>
      <td className="hidden px-3 py-2 text-right tabular-nums text-muted md:table-cell">
        {money(row.cost)}
      </td>
      <td
        className={`px-3 py-2 text-right font-semibold tabular-nums ${
          profit > 0 ? 'text-sell' : profit < 0 ? 'text-danger' : 'text-muted'
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

'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppHeader from './AppHeader'
import SetupNotice from './SetupNotice'
import Filters from './Filters'
import { useSupabase, isSupabaseConfigured } from './SupabaseProvider'
import { money, num } from '@/lib/format'

export default function InventarioPage() {
  const { supabase, status: sessionStatus, error: sessionError } = useSupabase()
  const [products, setProducts] = useState([])
  // Sin credenciales no hay nada que cargar: arrancamos directo en "listo"
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [loadError, setLoadError] = useState(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [stockFilter, setStockFilter] = useState('all') // all | in | low | out
  const [cart, setCart] = useState([]) // [{ id, name, price, cost, category, qty }]
  const [cartOpen, setCartOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const notify = useCallback((message, tone = 'ok') => {
    clearTimeout(toastTimer.current)
    setToast({ message, tone })
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])

  const fetchAll = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true })

    if (error) setLoadError(error.message)
    else {
      setLoadError(null)
      setProducts(data ?? [])
    }
    setLoading(false)
  }, [supabase])

  // Carga inicial (espera a que el provider entregue la sesion)
  useEffect(() => {
    if (!supabase) return
    // fetchAll es async: los setState ocurren despues del await, no de forma
    // sincrona dentro del efecto (falso positivo de la regla).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [supabase, fetchAll])

  // Realtime: mantiene el stock sincronizado entre todos los dispositivos
  // (incluye altas/bajas hechas desde la importación masiva por Excel).
  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel('inventario')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        (payload) => {
          setProducts((prev) => {
            if (payload.eventType === 'DELETE') {
              return prev.filter((p) => p.id !== payload.old.id)
            }
            const row = payload.new
            const exists = prev.some((p) => p.id === row.id)
            const next = exists
              ? prev.map((p) => (p.id === row.id ? { ...p, ...row } : p))
              : [...prev, row]
            return next.sort((a, b) => a.name.localeCompare(b.name, 'es'))
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Red de seguridad: si Realtime se cayo mientras la pantalla estaba en
  // segundo plano, refrescamos al volver.
  useEffect(() => {
    if (!supabase) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchAll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [supabase, fetchAll])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const cartQtyById = useMemo(() => {
    const map = new Map()
    for (const item of cart) map.set(item.id, item.qty)
    return map
  }, [cart])

  function addToCart(product) {
    const inCart = cartQtyById.get(product.id) ?? 0
    if (inCart >= product.stock) return
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id)
      if (existing) {
        return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          category: product.category,
          price: Number(product.price),
          cost: Number(product.cost),
          qty: 1,
        },
      ]
    })
  }

  function decFromCart(productId) {
    setCart((prev) =>
      prev.flatMap((i) => {
        if (i.id !== productId) return [i]
        if (i.qty <= 1) return []
        return [{ ...i, qty: i.qty - 1 }]
      })
    )
  }

  function removeFromCart(productId) {
    setCart((prev) => prev.filter((i) => i.id !== productId))
  }

  const cartCount = cart.reduce((acc, i) => acc + i.qty, 0)
  const cartTotal = cart.reduce((acc, i) => acc + i.qty * i.price, 0)

  async function checkout() {
    if (cart.length === 0 || checkingOut || !supabase) return
    setCheckingOut(true)

    const { data, error } = await supabase.rpc('sell_cart', {
      items: cart.map((i) => ({ product_id: i.id, qty: i.qty })),
    })

    setCheckingOut(false)

    if (error) {
      const msg = error.message || ''
      if (msg.includes('OUT_OF_STOCK:')) {
        const name = msg.split('OUT_OF_STOCK:')[1]?.trim()
        notify(`Sin stock suficiente para "${name || 'un producto'}". Ajusta el carrito.`, 'warn')
        fetchAll()
      } else {
        notify(error.message, 'error')
      }
      return
    }

    const updates = new Map((data?.items ?? []).map((x) => [x.product.id, x.product]))
    setProducts((prev) => prev.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id) } : p)))
    notify(`Venta registrada · ${money(cartTotal)}`)
    setCart([])
    setCartOpen(false)
  }

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'es'))
  }, [products])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.category ?? '').toLowerCase().includes(q)) {
        return false
      }
      if (category !== 'all' && p.category !== category) return false
      if (stockFilter === 'in' && p.stock <= 0) return false
      if (stockFilter === 'low' && (p.stock <= 0 || p.stock > 3)) return false
      if (stockFilter === 'out' && p.stock > 0) return false
      return true
    })
  }, [products, query, category, stockFilter])

  const totals = useMemo(() => {
    const units = products.reduce((acc, p) => acc + p.stock, 0)
    const value = products.reduce((acc, p) => acc + p.stock * Number(p.price), 0)
    return { units, value }
  }, [products])

  if (!isSupabaseConfigured) {
    return (
      <>
        <AppHeader />
        <SetupNotice />
      </>
    )
  }

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

  return (
    <>
      <AppHeader />

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 pb-28 pt-4 md:pb-8">
        <main className="min-w-0 flex-1">
          {/* Resumen */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-paper px-4 py-3 shadow-sm">
            <Stat label="Piezas en stock" value={num(totals.units)} />
            <span className="h-8 w-px bg-line" />
            <Stat label="Valor del inventario" value={money(totals.value)} />
            <Link
              href="/productos/nuevo"
              className="ml-auto flex items-center gap-1 rounded-xl bg-ink px-3 py-2 text-sm font-semibold text-white transition active:scale-95"
            >
              <span className="text-base leading-none">+</span>
              <span className="hidden sm:inline">Producto</span>
            </Link>
          </div>

          <Filters
            query={query}
            onQuery={setQuery}
            category={category}
            onCategory={setCategory}
            categories={categories}
            shown={filtered.length}
            total={products.length}
          >
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              className="rounded-xl border border-line bg-paper px-3 py-2.5 text-base outline-none focus:border-brand sm:text-sm"
            >
              <option value="all">Todo el stock</option>
              <option value="in">Con stock</option>
              <option value="low">Quedan pocos (≤3)</option>
              <option value="out">Agotados</option>
            </select>
          </Filters>

          {loadError && (
            <p className="mb-4 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-dark">
              No se pudo cargar el inventario: {loadError}
            </p>
          )}

          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-paper" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasProducts={products.length > 0} />
          ) : (
            <div className="overflow-x-auto rounded-xl bg-paper shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5 font-semibold">Producto</th>
                    <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">
                      Categoría
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">Precio</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">
                      Costo
                    </th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold lg:table-cell">
                      Ganancia
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">Stock</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      <span className="sr-only">Vender</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      qtyInCart={cartQtyById.get(product.id) ?? 0}
                      onAdd={() => addToCart(product)}
                      onDec={() => decFromCart(product.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        {/* Carrito: sidebar fijo en desktop */}
        <aside className="hidden w-80 shrink-0 md:block">
          <div className="sticky top-20">
            <CartCard
              cart={cart}
              total={cartTotal}
              busy={checkingOut}
              onInc={(id) => {
                const p = products.find((p) => p.id === id)
                if (p) addToCart(p)
              }}
              onDec={decFromCart}
              onRemove={removeFromCart}
              onCheckout={checkout}
            />
          </div>
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div
            className={`pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
              toast.tone === 'ok' ? 'bg-sell' : toast.tone === 'warn' ? 'bg-warn' : 'bg-brand-dark'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Carrito flotante: solo mobile */}
      <div className="md:hidden">
        {cartCount > 0 && !cartOpen && (
          <button
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-2xl bg-ink px-5 py-4 text-white shadow-lg active:scale-[.98]"
          >
            <span className="font-semibold">🛒 {cartCount} producto{cartCount === 1 ? '' : 's'}</span>
            <span className="font-bold">{money(cartTotal)}</span>
          </button>
        )}

        {cartOpen && (
          <div className="fixed inset-0 z-40 flex items-end bg-ink/40">
            <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-paper p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold">Carrito</h2>
                <button
                  onClick={() => setCartOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-cream"
                >
                  ✕
                </button>
              </div>
              <CartCard
                cart={cart}
                total={cartTotal}
                busy={checkingOut}
                onInc={(id) => {
                  const p = products.find((p) => p.id === id)
                  if (p) addToCart(p)
                }}
                onDec={decFromCart}
                onRemove={removeFromCart}
                onCheckout={checkout}
                bare
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="text-lg font-bold leading-tight">{value}</p>
    </div>
  )
}

function ProductRow({ product, qtyInCart, onAdd, onDec }) {
  const profit = Number(product.price) - Number(product.cost)
  const availableToAdd = product.stock - qtyInCart
  const soldOut = product.stock <= 0
  const low = !soldOut && product.stock <= 3

  return (
    <tr className="border-b border-line last:border-0 hover:bg-cream/50">
      <td className="px-3 py-2">
        <Link
          href={`/productos/${product.id}/editar`}
          className="font-medium hover:text-brand hover:underline"
          title="Editar producto"
        >
          {product.name}
        </Link>
        {/* En pantallas chicas la categoria no tiene columna propia */}
        {product.category && (
          <span className="block text-xs text-muted sm:hidden">{product.category}</span>
        )}
      </td>

      <td className="hidden px-3 py-2 sm:table-cell">
        {product.category ? (
          <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-medium text-muted">
            {product.category}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>

      <td className="px-3 py-2 text-right font-semibold tabular-nums">
        {money(product.price)}
      </td>
      <td className="hidden px-3 py-2 text-right tabular-nums text-muted md:table-cell">
        {money(product.cost)}
      </td>
      <td
        className={`hidden px-3 py-2 text-right tabular-nums lg:table-cell ${
          profit < 0 ? 'font-semibold text-brand-dark' : 'text-sell'
        }`}
      >
        {money(profit)}
      </td>

      <td className="px-3 py-2 text-center">
        <span
          className={`inline-block min-w-8 rounded-md px-2 py-0.5 font-bold tabular-nums ${
            soldOut
              ? 'bg-cream text-muted'
              : low
                ? 'bg-warn-soft text-warn'
                : ''
          }`}
        >
          {product.stock}
        </span>
      </td>

      <td className="whitespace-nowrap px-3 py-2">
        <div className="flex items-center justify-end">
          {soldOut ? (
            <span className="text-xs font-semibold text-muted">Agotado</span>
          ) : qtyInCart > 0 ? (
            <div className="flex items-center gap-1 rounded-lg bg-sell px-1 py-1 text-white">
              <button
                onClick={onDec}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 font-bold active:scale-90"
                aria-label="Quitar uno"
              >
                −
              </button>
              <span className="min-w-5 text-center font-bold tabular-nums">{qtyInCart}</span>
              <button
                onClick={onAdd}
                disabled={availableToAdd <= 0}
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 font-bold active:scale-90 disabled:opacity-40"
                aria-label="Agregar uno"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={onAdd}
              className="whitespace-nowrap rounded-lg bg-sell px-3 py-2 text-sm font-semibold text-white transition hover:bg-sell-dark active:scale-95"
              aria-label={`Agregar ${product.name} al carrito`}
            >
              + Agregar
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CartCard({ cart, total, busy, onInc, onDec, onRemove, onCheckout, bare = false }) {
  const body = (
    <>
      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          El carrito está vacío.
          <br />
          Toca &quot;+ Agregar&quot; en un producto.
        </p>
      ) : (
        <ul className="max-h-[45vh] space-y-2 overflow-y-auto md:max-h-96">
          {cart.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-xl bg-cream px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.name}</p>
                <p className="text-xs text-muted">{money(item.price)} c/u</p>
              </div>
              <button
                onClick={() => onDec(item.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-sm font-bold shadow-sm active:scale-90"
              >
                −
              </button>
              <span className="min-w-5 text-center text-sm font-bold">{item.qty}</span>
              <button
                onClick={() => onInc(item.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper text-sm font-bold shadow-sm active:scale-90"
              >
                +
              </button>
              <button
                onClick={() => onRemove(item.id)}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-paper hover:text-brand-dark"
                aria-label="Quitar del carrito"
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
        <span className="text-sm font-semibold text-muted">Total</span>
        <span className="text-2xl font-bold">{money(total)}</span>
      </div>

      <button
        onClick={onCheckout}
        disabled={cart.length === 0 || busy}
        className="mt-3 w-full rounded-2xl bg-ink px-6 py-4 text-base font-bold text-white shadow-sm transition active:scale-[.98] disabled:opacity-50"
      >
        {busy ? 'Registrando…' : 'Registrar compra'}
      </button>
    </>
  )

  if (bare) return body

  return (
    <div className="rounded-2xl bg-paper p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-bold">🛒 Carrito</h2>
      {body}
    </div>
  )
}

function EmptyState({ hasProducts }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper/60 px-6 py-12 text-center">
      <p className="text-4xl">{hasProducts ? '🔍' : '📦'}</p>
      <p className="mt-3 font-semibold">
        {hasProducts ? 'Sin resultados' : 'Todavía no hay productos'}
      </p>
      <p className="mt-1 text-sm text-muted">
        {hasProducts
          ? 'Ningún producto coincide con los filtros. Prueba con otro nombre, categoría o estado de stock.'
          : 'Agrega el primero para empezar a vender, o usa "Importar" para cargar varios desde Excel.'}
      </p>
      {!hasProducts && (
        <Link
          href="/productos/nuevo"
          className="mt-5 inline-block rounded-2xl bg-ink px-5 py-3 font-semibold text-white"
        >
          + Agregar producto
        </Link>
      )}
    </div>
  )
}

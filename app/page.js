'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppHeader from './AppHeader'
import SetupNotice from './SetupNotice'
import Filters from './Filters'
import FairSidebar from './FairSidebar'
import Modal from './Modal'
import { useSupabase, isSupabaseConfigured } from './SupabaseProvider'
import { useFair } from './FairProvider'
import { computeCartPricing } from '@/lib/promos'
import { money, num } from '@/lib/format'

export default function InventarioPage() {
  const { supabase, status: sessionStatus, error: sessionError } = useSupabase()
  const { activeFair, promotions } = useFair()

  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [loadError, setLoadError] = useState(null)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')

  const [cart, setCart] = useState([])
  const [cartOpen, setCartOpen] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)

  // Modo borrado multiple
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const notify = useCallback((message, tone = 'ok') => {
    clearTimeout(toastTimer.current)
    setToast({ message, tone })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const fairId = activeFair?.id

  const fetchAll = useCallback(async () => {
    if (!supabase || !fairId) return
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('fair_id', fairId)
      .order('name', { ascending: true })

    if (error) setLoadError(error.message)
    else {
      setLoadError(null)
      setProducts(data ?? [])
    }
    setLoading(false)
  }, [supabase, fairId])

  // Cambiar de feria limpia el carrito y la seleccion: mezclar productos de dos
  // ferias no tendria sentido contable.
  // Se ajusta durante el render (patron documentado de React para resetear
  // estado cuando cambia una entrada) en vez de en un efecto, que provocaria
  // un render extra con el carrito de la feria anterior.
  const [prevFairId, setPrevFairId] = useState(fairId)
  if (fairId !== prevFairId) {
    setPrevFairId(fairId)
    setCart([])
    setSelected(new Set())
    setSelectMode(false)
  }

  useEffect(() => {
    if (!supabase || !fairId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [supabase, fairId, fetchAll])

  useEffect(() => {
    if (!supabase || !fairId) return
    const channel = supabase
      .channel(`inventario-${fairId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `fair_id=eq.${fairId}` },
        (payload) => {
          setProducts((prev) => {
            if (payload.eventType === 'DELETE') return prev.filter((p) => p.id !== payload.old.id)
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
    return () => supabase.removeChannel(channel)
  }, [supabase, fairId])

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

  const pricing = useMemo(
    () => computeCartPricing(cart, promotions),
    [cart, promotions]
  )

  function addToCart(product) {
    const inCart = cartQtyById.get(product.id) ?? 0
    if (inCart >= product.stock) return
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id)
      if (existing) return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
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

  const decFromCart = (id) =>
    setCart((prev) =>
      prev.flatMap((i) => (i.id !== id ? [i] : i.qty <= 1 ? [] : [{ ...i, qty: i.qty - 1 }]))
    )
  const removeFromCart = (id) => setCart((prev) => prev.filter((i) => i.id !== id))

  const cartCount = cart.reduce((acc, i) => acc + i.qty, 0)

  async function checkout() {
    if (cart.length === 0 || checkingOut || !supabase) return
    setCheckingOut(true)

    const { data, error } = await supabase.rpc('sell_cart', {
      p_fair_id: fairId,
      items: pricing.lines.map((l) => ({
        product_id: l.id,
        qty: l.qty,
        charged: l.charged,
        promotion_name: l.promotionName,
      })),
    })
    setCheckingOut(false)

    if (error) {
      const msg = error.message || ''
      if (msg.includes('OUT_OF_STOCK:')) {
        notify(`Sin stock suficiente para "${msg.split('OUT_OF_STOCK:')[1]?.trim()}"`, 'warn')
        fetchAll()
      } else notify(error.message, 'error')
      return
    }

    const updates = new Map((data?.items ?? []).map((x) => [x.product.id, x.product]))
    setProducts((prev) => prev.map((p) => (updates.has(p.id) ? { ...p, ...updates.get(p.id) } : p)))
    notify(`Venta registrada · ${money(pricing.total)}`)
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
      if (q && !p.name.toLowerCase().includes(q) && !(p.category ?? '').toLowerCase().includes(q))
        return false
      if (category !== 'all' && p.category !== category) return false
      if (stockFilter === 'in' && p.stock <= 0) return false
      if (stockFilter === 'low' && (p.stock <= 0 || p.stock > 3)) return false
      if (stockFilter === 'out' && p.stock > 0) return false
      return true
    })
  }, [products, query, category, stockFilter])

  const totals = useMemo(
    () => ({
      units: products.reduce((acc, p) => acc + p.stock, 0),
      value: products.reduce((acc, p) => acc + p.stock * Number(p.price), 0),
    }),
    [products]
  )

  const selectedProducts = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected]
  )

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id))

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((p) => next.delete(p.id))
      else filtered.forEach((p) => next.add(p.id))
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  async function deleteSelected() {
    setDeleting(true)
    const ids = [...selected]
    const { error } = await supabase.from('products').delete().in('id', ids)
    setDeleting(false)
    if (error) return notify(error.message, 'error')

    setProducts((prev) => prev.filter((p) => !selected.has(p.id)))
    setCart((prev) => prev.filter((i) => !selected.has(i.id)))
    notify(`${ids.length} producto(s) eliminado(s)`, 'warn')
    setConfirmDelete(false)
    exitSelectMode()
  }

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
          <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
            No se pudo iniciar la sesión con la base de datos: {sessionError}
          </p>
        </main>
      </>
    )
  }

  return (
    <>
      <AppHeader />

      {/*
        flex-col en movil, flex-row recien en lg: FairSidebar devuelve un
        fragmento con el aside de escritorio (hidden lg:block) y la fila
        movil (lg:hidden) como hermanos. Si este contenedor fuera "flex"
        (fila) en TODOS los tamanos, en movil la fila de ferias quedaria
        como hermana de <main> dentro de esa fila, y el align-items:stretch
        por defecto la estira a la altura completa de la pagina (y eso se
        propaga a sus botones, que tambien son flex). En columna, el cross
        axis es el ancho, no el alto, asi que solo se estira a 100% de ancho
        (lo esperado) y la altura queda segun su contenido.
      */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-4 pb-28 pt-4 md:pb-8 lg:flex-row">
        <FairSidebar />

        <main className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-paper px-4 py-3 shadow-sm">
            <Stat label="Piezas en stock" value={num(totals.units)} />
            <span className="h-8 w-px bg-line" />
            <Stat label="Valor del inventario" value={money(totals.value)} />

            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/productos/nuevo"
                className="flex items-center gap-1 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-95"
              >
                <span className="text-base leading-none">+</span>
                <span className="hidden sm:inline">Producto</span>
              </Link>
              <button
                onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                aria-label="Eliminar productos"
                title="Eliminar varios productos"
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition ${
                  selectMode
                    ? 'border-danger bg-danger text-white'
                    : 'border-danger/40 text-danger hover:bg-danger-soft'
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>

          {selectMode && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-danger bg-danger-soft px-4 py-3">
              <span className="text-sm font-semibold text-danger">
                Modo eliminar · {selected.size} seleccionado(s)
              </span>
              <button
                onClick={toggleAllFiltered}
                className="rounded-lg bg-paper px-3 py-1.5 text-xs font-semibold hover:bg-cream"
              >
                {allFilteredSelected ? 'Quitar selección' : `Seleccionar los ${filtered.length} visibles`}
              </button>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={exitSelectMode}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-paper"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={selected.size === 0}
                  className="rounded-lg bg-danger px-4 py-1.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  Aceptar
                </button>
              </div>
            </div>
          )}

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
            <p className="mb-4 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
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
                    {selectMode && (
                      <th className="w-10 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAllFiltered}
                          className="h-4 w-4 accent-[#c0392b]"
                          aria-label="Seleccionar todos"
                        />
                      </th>
                    )}
                    <th className="px-3 py-2.5 font-semibold">Producto</th>
                    <th className="hidden px-3 py-2.5 font-semibold sm:table-cell">Categoría</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Precio</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">Costo</th>
                    <th className="hidden px-3 py-2.5 text-right font-semibold lg:table-cell">Ganancia</th>
                    <th className="px-3 py-2.5 text-center font-semibold">Stock</th>
                    {!selectMode && (
                      <th className="px-3 py-2.5 text-right font-semibold">
                        <span className="sr-only">Vender</span>
                      </th>
                    )}
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
                      selectMode={selectMode}
                      checked={selected.has(product.id)}
                      onToggle={() => toggleSelected(product.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>

        <aside className="hidden w-80 shrink-0 md:block">
          <div className="sticky top-20">
            <CartCard
              cart={cart}
              pricing={pricing}
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

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div
            className={`pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-center text-sm font-semibold text-white shadow-lg ${
              toast.tone === 'ok' ? 'bg-sell' : toast.tone === 'warn' ? 'bg-warn' : 'bg-danger'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Carrito flotante en movil */}
      <div className="md:hidden">
        {cartCount > 0 && !cartOpen && !selectMode && (
          <button
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-4 bottom-4 z-30 flex items-center justify-between rounded-xl bg-brand px-5 py-3.5 text-white shadow-lg active:scale-[.98]"
          >
            <span className="font-semibold">
              🛒 {cartCount} producto{cartCount === 1 ? '' : 's'}
            </span>
            <span className="font-bold">{money(pricing.total)}</span>
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
                pricing={pricing}
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

      {/* Confirmacion de borrado masivo */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Eliminar productos"
        subtitle="Esta acción no se puede deshacer"
        size="md"
      >
        <div className="space-y-4">
          <p className="rounded-xl border-2 border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            Vas a eliminar <strong>{selectedProducts.length} producto(s)</strong> y su
            stock. Las ventas ya registradas se conservan en los reportes.
          </p>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-cream">
                <tr className="text-left text-xs uppercase text-muted">
                  <th className="px-3 py-2 font-semibold">Producto</th>
                  <th className="px-3 py-2 text-center font-semibold">Stock</th>
                </tr>
              </thead>
              <tbody>
                {selectedProducts.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-3 py-1.5">
                      {p.name}
                      {p.category && (
                        <span className="ml-2 text-xs text-muted">{p.category}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center font-semibold tabular-nums">
                      {p.stock}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-cream font-bold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {selectedProducts.reduce((a, p) => a + p.stock, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-xl bg-cream px-4 py-3 font-semibold hover:bg-line"
            >
              No, cancelar
            </button>
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="flex-1 rounded-xl bg-danger px-4 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {deleting ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="text-lg font-bold leading-tight">{value}</p>
    </div>
  )
}

function ProductRow({ product, qtyInCart, onAdd, onDec, selectMode, checked, onToggle }) {
  const profit = Number(product.price) - Number(product.cost)
  const availableToAdd = product.stock - qtyInCart
  const soldOut = product.stock <= 0
  const low = !soldOut && product.stock <= 3

  return (
    <tr
      className={`border-b border-line last:border-0 ${
        checked ? 'bg-danger-soft' : 'hover:bg-cream/60'
      }`}
    >
      {selectMode && (
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 accent-[#c0392b]"
            aria-label={`Seleccionar ${product.name}`}
          />
        </td>
      )}

      <td className="px-3 py-2">
        {selectMode ? (
          <button onClick={onToggle} className="text-left font-medium">
            {product.name}
          </button>
        ) : (
          <Link
            href={`/productos/${product.id}/editar`}
            className="font-medium hover:text-brand hover:underline"
            title="Editar producto"
          >
            {product.name}
          </Link>
        )}
        {product.category && (
          <span className="block text-xs text-muted sm:hidden">{product.category}</span>
        )}
      </td>

      <td className="hidden px-3 py-2 sm:table-cell">
        {product.category ? (
          <span className="rounded-full bg-lilac-soft px-2 py-0.5 text-xs font-medium text-brand">
            {product.category}
          </span>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>

      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(product.price)}</td>
      <td className="hidden px-3 py-2 text-right tabular-nums text-muted md:table-cell">
        {money(product.cost)}
      </td>
      <td
        className={`hidden px-3 py-2 text-right tabular-nums lg:table-cell ${
          profit < 0 ? 'font-semibold text-danger' : 'text-sell'
        }`}
      >
        {money(profit)}
      </td>

      <td className="px-3 py-2 text-center">
        <span
          className={`inline-block min-w-8 rounded-md px-2 py-0.5 font-bold tabular-nums ${
            soldOut ? 'bg-cream text-muted' : low ? 'bg-warn-soft text-warn' : ''
          }`}
        >
          {product.stock}
        </span>
      </td>

      {!selectMode && (
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
      )}
    </tr>
  )
}

function CartCard({ cart, pricing, busy, onInc, onDec, onRemove, onCheckout, bare = false }) {
  const body = (
    <>
      {cart.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          El carrito está vacío.
          <br />
          Toca &quot;+ Agregar&quot; en un producto.
        </p>
      ) : (
        <ul className="max-h-[40vh] space-y-2 overflow-y-auto md:max-h-80">
          {pricing.lines.map((item) => (
            <li key={item.id} className="rounded-xl bg-cream px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  <p className="text-xs text-muted">
                    {money(item.price)} c/u
                    {item.promotionName && (
                      <span className="ml-1 font-semibold text-brand">· en promo</span>
                    )}
                  </p>
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
                  className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-paper hover:text-danger"
                  aria-label="Quitar del carrito"
                >
                  🗑
                </button>
              </div>
              {item.charged !== item.listTotal && (
                <p className="mt-1 text-right text-xs">
                  <span className="text-muted line-through">{money(item.listTotal)}</span>{' '}
                  <span className="font-semibold text-sell">{money(item.charged)}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {pricing.promoSummary.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-brand-soft px-3 py-2">
          {pricing.promoSummary.map((p) => (
            <li key={p.category} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-brand-dark">
                🏷️ {p.name}
                <span className="font-normal text-muted"> · {p.unidades} u.</span>
              </span>
              <span className="font-semibold text-sell">−{money(p.ahorro)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-1 border-t border-line pt-3">
        {pricing.ahorro > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Sin promociones</span>
            <span className="text-muted line-through">{money(pricing.listTotal)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-muted">Total</span>
          <span className="text-2xl font-bold">{money(pricing.total)}</span>
        </div>
      </div>

      <button
        onClick={onCheckout}
        disabled={cart.length === 0 || busy}
        className="mt-3 w-full rounded-xl bg-brand px-6 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-brand-dark active:scale-[.98] disabled:opacity-50"
      >
        {busy ? 'Registrando…' : 'Registrar compra'}
      </button>
    </>
  )

  if (bare) return body

  return (
    <div className="rounded-xl bg-paper p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-bold">🛒 Carrito</h2>
      {body}
    </div>
  )
}

function EmptyState({ hasProducts }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper/60 px-6 py-12 text-center">
      <p className="text-4xl">{hasProducts ? '🔍' : '📦'}</p>
      <p className="mt-3 font-semibold">
        {hasProducts ? 'Sin resultados' : 'Esta feria todavía no tiene productos'}
      </p>
      <p className="mt-1 text-sm text-muted">
        {hasProducts
          ? 'Ningún producto coincide con los filtros.'
          : 'Agrega el primero, o usa "Importar" para cargar varios desde Excel.'}
      </p>
      {!hasProducts && (
        <Link
          href="/productos/nuevo"
          className="mt-5 inline-block rounded-xl bg-brand px-5 py-3 font-semibold text-white"
        >
          + Agregar producto
        </Link>
      )}
    </div>
  )
}

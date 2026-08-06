'use client'

import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useSupabase } from './SupabaseProvider'
import { useFair } from './FairProvider'
import { computeCartPricing } from '@/lib/promos'
import { money } from '@/lib/format'

// Edita una venta ya registrada: quitar productos (devolucion) o agregar otros
// (cambio). Al guardar, el RPC update_sale recalcula el stock por diferencia y
// reemplaza las lineas, todo en una transaccion.
//
// El precio se vuelve a calcular con las promociones ACTUALES, para que el
// ticket editado quede coherente consigo mismo.
export default function EditSaleModal({ open, onClose, sale, onSaved }) {
  const { supabase } = useSupabase()
  const { activeFair, promotions } = useFair()

  const [lines, setLines] = useState([]) // [{id, name, category, price, cost, qty}]
  const [products, setProducts] = useState([])
  const [adding, setAdding] = useState(false)
  const [pickQuery, setPickQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open || !sale) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLines(
      sale.items.map((i) => ({
        id: i.product_id,
        name: i.product_name,
        category: i.category,
        price: Number(i.price),
        cost: Number(i.cost),
        qty: i.qty,
        missing: !i.product_id, // producto borrado del inventario
      }))
    )
    setError(null)
    setAdding(false)
    setPickQuery('')
  }, [open, sale])

  useEffect(() => {
    if (!open || !supabase || !activeFair) return
    supabase
      .from('products')
      .select('*')
      .eq('fair_id', activeFair.id)
      .order('name', { ascending: true })
      .then(({ data }) => setProducts(data ?? []))
  }, [open, supabase, activeFair])

  const pricing = useMemo(
    () => computeCartPricing(lines.filter((l) => l.id), promotions),
    [lines, promotions]
  )

  const stockById = useMemo(() => new Map(products.map((p) => [p.id, p.stock])), [products])

  // Cuanto habia en esta venta originalmente: esas unidades vuelven al stock
  // antes de re-descontar, asi que estan disponibles para la edicion.
  const originalQty = useMemo(() => {
    const m = new Map()
    for (const i of sale?.items ?? []) m.set(i.product_id, i.qty)
    return m
  }, [sale])

  function maxFor(line) {
    const enStock = stockById.get(line.id) ?? 0
    return enStock + (originalQty.get(line.id) ?? 0)
  }

  const setQty = (id, delta) =>
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.id !== id) return [l]
        const next = l.qty + delta
        if (next <= 0) return []
        if (delta > 0 && next > maxFor(l)) return [l]
        return [{ ...l, qty: next }]
      })
    )

  const removeLine = (id) => setLines((prev) => prev.filter((l) => l.id !== id))

  function addProduct(p) {
    setLines((prev) => {
      const existing = prev.find((l) => l.id === p.id)
      if (existing) {
        const max = (stockById.get(p.id) ?? 0) + (originalQty.get(p.id) ?? 0)
        if (existing.qty >= max) return prev
        return prev.map((l) => (l.id === p.id ? { ...l, qty: l.qty + 1 } : l))
      }
      return [
        ...prev,
        {
          id: p.id,
          name: p.name,
          category: p.category,
          price: Number(p.price),
          cost: Number(p.cost),
          qty: 1,
        },
      ]
    })
    setAdding(false)
    setPickQuery('')
  }

  async function save() {
    setBusy(true)
    setError(null)

    const items = pricing.lines.map((l) => ({
      product_id: l.id,
      qty: l.qty,
      charged: l.charged,
      promotion_name: l.promotionName,
    }))

    const { error: dbError } = await supabase.rpc('update_sale', {
      p_sale_id: sale.sale_id,
      items,
    })
    setBusy(false)

    if (dbError) {
      const msg = dbError.message || ''
      if (msg.includes('OUT_OF_STOCK:')) {
        return setError(`Sin stock suficiente para "${msg.split('OUT_OF_STOCK:')[1]?.trim()}"`)
      }
      return setError(msg)
    }

    onSaved()
    onClose()
  }

  const disponibles = useMemo(() => {
    const q = pickQuery.trim().toLowerCase()
    return products
      .filter((p) => p.stock > 0 || originalQty.has(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q))
      .slice(0, 40)
  }, [products, pickQuery, originalQty])

  const vacia = lines.length === 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar venta"
      subtitle={
        sale
          ? new Date(sale.sold_at).toLocaleString('es-CO', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })
          : ''
      }
      size="lg"
    >
      <div className="space-y-4">
        <button
          onClick={() => setAdding((v) => !v)}
          className="w-full rounded-xl border-2 border-dashed border-brand px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand-soft"
        >
          {adding ? 'Cancelar' : '+ Agregar producto manualmente'}
        </button>

        {adding && (
          <div className="rounded-xl border border-line p-3">
            <input
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              autoFocus
              placeholder="Buscar producto…"
              className="w-full rounded-lg border border-line bg-cream px-3 py-2 text-sm outline-none focus:border-brand focus:bg-paper"
            />
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {disponibles.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => addProduct(p)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-cream"
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-muted">quedan {p.stock}</span>
                    <span className="font-semibold tabular-nums">{money(p.price)}</span>
                  </button>
                </li>
              ))}
              {disponibles.length === 0 && (
                <li className="px-2 py-3 text-center text-xs text-muted">Sin resultados</li>
              )}
            </ul>
          </div>
        )}

        {vacia ? (
          <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            La venta quedó sin productos. Si guardas así, se elimina por completo y todo
            vuelve al stock.
          </p>
        ) : (
          <ul className="space-y-2">
            {pricing.lines.map((l) => (
              <li key={l.id} className="rounded-xl bg-cream px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{l.name}</p>
                    <p className="text-xs text-muted">
                      {money(l.price)} c/u
                      {l.promotionName && (
                        <span className="ml-1 font-semibold text-brand">· {l.promotionName}</span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => setQty(l.id, -1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper font-bold shadow-sm active:scale-90"
                    aria-label="Quitar uno"
                  >
                    −
                  </button>
                  <span className="min-w-5 text-center text-sm font-bold tabular-nums">
                    {l.qty}
                  </span>
                  <button
                    onClick={() => setQty(l.id, 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-paper font-bold shadow-sm active:scale-90"
                    aria-label="Agregar uno"
                  >
                    +
                  </button>
                  <span className="min-w-20 text-right text-sm font-semibold tabular-nums">
                    {money(l.charged)}
                  </span>
                  <button
                    onClick={() => removeLine(l.id)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-paper hover:text-danger"
                    aria-label={`Quitar ${l.name} de la venta`}
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Lineas de productos que ya no existen en el inventario */}
        {lines.some((l) => l.missing) && (
          <p className="rounded-xl bg-warn-soft px-4 py-2.5 text-xs text-warn">
            Esta venta tiene productos que ya se borraron del inventario. Al guardar se
            quitarán del ticket porque no hay stock al que devolverlos.
          </p>
        )}

        <div className="space-y-1 border-t border-line pt-3">
          {pricing.ahorro > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-muted">Sin promociones</span>
              <span className="text-muted line-through">{money(pricing.listTotal)}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-muted">Nuevo total</span>
            <span className="text-2xl font-bold">{money(pricing.total)}</span>
          </div>
          {sale && pricing.total !== sale.total && (
            <p className="text-right text-xs text-muted">
              Antes: <span className="line-through">{money(sale.total)}</span>
            </p>
          )}
        </div>

        {error && (
          <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-cream px-4 py-3 font-semibold hover:bg-line"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={busy}
            className={`flex-1 rounded-xl px-4 py-3 font-bold text-white transition disabled:opacity-50 ${
              vacia ? 'bg-danger hover:brightness-110' : 'bg-brand hover:bg-brand-dark'
            }`}
          >
            {busy ? 'Guardando…' : vacia ? 'Eliminar venta' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

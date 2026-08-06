'use client'

import { useCallback, useEffect, useState } from 'react'
import Modal from './Modal'
import { useSupabase } from './SupabaseProvider'
import { useFair } from './FairProvider'
import { money, num } from '@/lib/format'

export default function DeleteFairModal({ open, onClose }) {
  const { supabase } = useSupabase()
  const { activeFair, fairs, reloadFairs, setActiveId } = useFair()

  const [resumen, setResumen] = useState(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const loadResumen = useCallback(async () => {
    if (!supabase || !activeFair) return
    const [prods, ventas] = await Promise.all([
      supabase.from('products').select('stock').eq('fair_id', activeFair.id),
      supabase.from('sales').select('charged').eq('fair_id', activeFair.id),
    ])
    setResumen({
      productos: prods.data?.length ?? 0,
      stock: (prods.data ?? []).reduce((a, p) => a + p.stock, 0),
      unidadesVendidas: ventas.data?.length ?? 0,
      ingresos: (ventas.data ?? []).reduce((a, s) => a + Number(s.charged ?? 0), 0),
    })
    setConfirmText('')
    setError(null)
  }, [supabase, activeFair])

  useEffect(() => {
    if (!open) return
    // loadResumen es async: los setState ocurren despues del await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadResumen()
  }, [open, loadResumen])

  const esUnica = fairs.length <= 1
  const puedeBorrar = confirmText.trim().toLowerCase() === activeFair?.name.trim().toLowerCase()

  async function borrar() {
    setBusy(true)
    const { error: dbError } = await supabase.rpc('delete_fair', { p_fair_id: activeFair.id })
    setBusy(false)
    if (dbError) return setError(dbError.message)

    const restantes = fairs.filter((f) => f.id !== activeFair.id)
    setActiveId(restantes[0]?.id ?? null)
    await reloadFairs()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Eliminar feria"
      subtitle={activeFair?.name}
      size="md"
    >
      {esUnica ? (
        <div className="space-y-4">
          <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            Esta es tu única feria y no se puede eliminar. Si quieres empezar de cero,
            crea primero una feria nueva y después elimina esta.
          </p>
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-cream px-6 py-3 font-semibold hover:bg-line"
          >
            Entendido
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-danger bg-danger-soft p-4">
            <p className="font-bold text-danger">Esto no se puede deshacer</p>
            <p className="mt-1 text-sm text-danger">
              Se borrará <strong>todo</strong> lo de esta feria: sus productos, su
              historial de ventas y sus promociones. Las demás ferias no se tocan.
            </p>
          </div>

          {resumen && (
            <ul className="space-y-1.5 rounded-xl bg-cream p-4 text-sm">
              <li className="flex justify-between">
                <span className="text-muted">Productos</span>
                <span className="font-semibold">{num(resumen.productos)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted">Piezas en stock</span>
                <span className="font-semibold">{num(resumen.stock)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-muted">Unidades vendidas</span>
                <span className="font-semibold">{num(resumen.unidadesVendidas)}</span>
              </li>
              <li className="flex justify-between border-t border-line pt-1.5">
                <span className="text-muted">Ingresos registrados</span>
                <span className="font-semibold">{money(resumen.ingresos)}</span>
              </li>
            </ul>
          )}

          <label className="block">
            <span className="text-sm">
              Para confirmar, escribe el nombre de la feria:{' '}
              <strong>{activeFair?.name}</strong>
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={activeFair?.name}
              className="mt-1.5 w-full rounded-xl border border-line bg-cream px-4 py-2.5 outline-none focus:border-danger focus:bg-paper"
            />
          </label>

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
              onClick={borrar}
              disabled={!puedeBorrar || busy}
              className="flex-1 rounded-xl bg-danger px-4 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? 'Eliminando…' : 'Eliminar feria'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

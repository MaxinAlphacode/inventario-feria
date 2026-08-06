'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useSupabase } from './SupabaseProvider'

const FairContext = createContext(null)

export function useFair() {
  return useContext(FairContext) ?? {}
}

// Colores disponibles para las tarjetas de feria. Los tonos vienen de la
// paleta de la marca; se guardan por nombre para no meter hex en la base.
export const FAIR_COLORS = {
  purple: { label: 'Morado', card: 'bg-brand-soft border-brand', dot: 'bg-brand' },
  lilac: { label: 'Lila', card: 'bg-lilac-soft border-lilac', dot: 'bg-lilac' },
  pink: { label: 'Rosa', card: 'bg-pink-soft border-pink', dot: 'bg-pink' },
  mint: { label: 'Verde', card: 'bg-sell/10 border-sell', dot: 'bg-sell' },
  sand: { label: 'Arena', card: 'bg-warn-soft border-warn', dot: 'bg-warn' },
}

const ACTIVE_KEY = 'inv_tami_feria_activa'

export default function FairProvider({ children }) {
  const { supabase } = useSupabase()
  const [fairs, setFairs] = useState([])
  const [promotions, setPromotions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadFairs = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('fairs')
      .select('*')
      .order('created_at', { ascending: false })
    const list = data ?? []
    setFairs(list)

    // Elegir feria activa aca (y no en un efecto aparte) para no encadenar
    // renders: la guardada si todavia existe, si no la mas reciente.
    setActiveId((prev) => {
      if (prev && list.some((f) => f.id === prev)) return prev
      const saved = window.localStorage.getItem(ACTIVE_KEY)
      if (saved && list.some((f) => f.id === saved)) return saved
      return list[0]?.id ?? null
    })
    setLoading(false)
  }, [supabase])

  const loadPromotions = useCallback(async (fairId) => {
    if (!supabase || !fairId) {
      setPromotions([])
      return
    }
    const { data } = await supabase
      .from('promotions')
      .select('*')
      .eq('fair_id', fairId)
      .order('created_at', { ascending: true })
    setPromotions(data ?? [])
  }, [supabase])

  useEffect(() => {
    if (!supabase) return
    // loadFairs es async: los setState ocurren despues del await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFairs()
  }, [supabase, loadFairs])

  useEffect(() => {
    if (!activeId) return
    window.localStorage.setItem(ACTIVE_KEY, activeId)
    // loadPromotions es async: los setState ocurren despues del await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPromotions(activeId)
  }, [activeId, loadPromotions])

  const activeFair = useMemo(
    () => fairs.find((f) => f.id === activeId) ?? null,
    [fairs, activeId]
  )

  const value = useMemo(
    () => ({
      fairs,
      activeFair,
      activeId,
      setActiveId,
      loading,
      reloadFairs: loadFairs,
      promotions,
      reloadPromotions: () => loadPromotions(activeId),
    }),
    [fairs, activeFair, activeId, loading, loadFairs, promotions, loadPromotions]
  )

  return <FairContext.Provider value={value}>{children}</FairContext.Provider>
}

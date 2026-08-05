'use client'

// Barra de filtros compartida entre Inventario y Reportes. `children` deja que
// cada pantalla agregue sus propios controles (ej. el filtro de stock).
export default function Filters({
  query,
  onQuery,
  category,
  onCategory,
  categories,
  shown,
  total,
  children,
}) {
  const filtering = query.trim() !== '' || category !== 'all'

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full rounded-xl border border-line bg-paper py-2.5 pl-9 pr-8 text-base outline-none focus:border-brand sm:text-sm"
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            ⌕
          </span>
          {query && (
            <button
              onClick={() => onQuery('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>

        <select
          value={category}
          onChange={(e) => onCategory(e.target.value)}
          className="rounded-xl border border-line bg-paper px-3 py-2.5 text-base outline-none focus:border-brand sm:text-sm"
        >
          <option value="all">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        {children}
      </div>

      <p className="text-xs text-muted">
        {filtering ? (
          <>
            Mostrando <span className="font-semibold text-ink">{shown}</span> de {total}{' '}
            productos
          </>
        ) : (
          <>
            <span className="font-semibold text-ink">{total}</span> productos
          </>
        )}
      </p>
    </div>
  )
}

import 'server-only'
import ExcelJS from 'exceljs'

// Este modulo corre SOLO en el servidor (route handlers). El bundle de ExcelJS
// para navegador se cuelga al cargar un .xlsx, y ademas pesa ~1MB: haciendolo
// aca el navegador no descarga nada de eso.

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0533D' } }
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } }

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g')

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .trim()
    .toLowerCase()
}

const ALIASES = {
  id: ['id'],
  name: ['nombre'],
  category: ['categoria'],
  price: ['precio de venta', 'precio'],
  cost: ['costo'],
  stock: ['cantidad', 'stock'],
}

function resolveColumns(headerRow) {
  const cols = {}
  headerRow.eachCell((cell, colNumber) => {
    const norm = normalize(cell.value)
    // startsWith (no igual exacto) para que headers como "ID (no editar)" o
    // "Cantidad disponible" sigan resolviendo a su clave.
    for (const [key, aliases] of Object.entries(ALIASES)) {
      if (cols[key] !== undefined) continue
      if (aliases.some((alias) => norm.startsWith(alias))) {
        cols[key] = colNumber
      }
    }
  })
  return cols
}

function styleHeader(sheet) {
  const row = sheet.getRow(1)
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
  })
  row.height = 20
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function setWidths(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w
  })
}

export async function buildProductsTemplate() {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Productos')
  sheet.addRow(['Nombre', 'Categoría', 'Precio de venta', 'Costo', 'Cantidad'])
  styleHeader(sheet)
  sheet.addRow(['Sticker gato astronauta', 'Stickers', 5000, 2000, 20])
  setWidths(sheet, [36, 18, 16, 14, 12])
  return wb.xlsx.writeBuffer()
}

export async function buildInventoryExport(products) {
  const wb = new ExcelJS.Workbook()
  const sheet = wb.addWorksheet('Inventario')
  sheet.addRow([
    'ID (no editar)',
    'Nombre',
    'Categoría',
    'Precio de venta',
    'Costo',
    'Cantidad',
  ])
  styleHeader(sheet)
  for (const p of products) {
    sheet.addRow([
      p.id,
      p.name,
      p.category ?? '',
      Number(p.price),
      Number(p.cost),
      p.stock,
    ])
  }
  sheet.getColumn(1).font = { color: { argb: 'FF9CA3AF' }, size: 9 }
  setWidths(sheet, [30, 36, 18, 16, 14, 12])
  return wb.xlsx.writeBuffer()
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0
  // Celdas con formula devuelven { formula, result }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    value = value.result
  }
  const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(',', '.')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  // Celdas con texto enriquecido devuelven { richText: [...] }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('').trim()
    }
    if ('result' in value) return String(value.result ?? '').trim()
    if ('text' in value) return String(value.text ?? '').trim()
  }
  return String(value).trim()
}

// Lee un .xlsx y devuelve filas normalizadas + errores legibles.
// Si el archivo no trae columna "ID", esa clave queda sin resolver y el
// llamador trata todas las filas como altas nuevas.
export async function parseProductsBuffer(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheet = wb.worksheets[0]

  if (!sheet) return { rows: [], errors: ['El archivo no tiene hojas.'] }

  const cols = resolveColumns(sheet.getRow(1))
  if (!cols.name) {
    return {
      rows: [],
      errors: [
        'No se encontró la columna "Nombre". Usa la plantilla descargada, sin cambiar los encabezados.',
      ],
    }
  }

  const rows = []
  const errors = []

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const raw = (key) => (cols[key] ? row.getCell(cols[key]).value : undefined)
    const name = cellText(raw('name'))

    const isBlankRow =
      !name &&
      raw('category') == null &&
      raw('price') == null &&
      raw('cost') == null &&
      raw('stock') == null
    if (isBlankRow) return

    if (!name) {
      errors.push(`Fila ${rowNumber}: falta el nombre.`)
      return
    }

    const price = toNumber(raw('price'))
    const cost = toNumber(raw('cost'))
    const stock = toNumber(raw('stock'))

    if (price === null) {
      errors.push(`Fila ${rowNumber} (${name}): "Precio de venta" no es un número válido.`)
      return
    }
    if (cost === null) {
      errors.push(`Fila ${rowNumber} (${name}): "Costo" no es un número válido.`)
      return
    }
    if (stock === null) {
      errors.push(`Fila ${rowNumber} (${name}): "Cantidad" no es un número válido.`)
      return
    }
    if (price < 0 || cost < 0 || stock < 0) {
      errors.push(`Fila ${rowNumber} (${name}): los valores no pueden ser negativos.`)
      return
    }

    const id = cellText(raw('id')) || null
    const category = cellText(raw('category')) || null

    rows.push({ id, name, category, price, cost, stock: Math.trunc(stock) })
  })

  return { rows, errors }
}

import { buildProductsTemplate, XLSX_MIME } from '@/lib/excel'

export async function GET() {
  const buffer = await buildProductsTemplate()
  return new Response(buffer, {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': 'attachment; filename="plantilla-productos.xlsx"',
    },
  })
}

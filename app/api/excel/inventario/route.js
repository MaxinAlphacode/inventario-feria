import { buildInventoryExport, XLSX_MIME } from '@/lib/excel'

// El cliente manda los productos que ya tiene cargados de Supabase, para no
// duplicar credenciales ni consultas del lado del servidor.
export async function POST(request) {
  let products
  try {
    const body = await request.json()
    products = body?.products
  } catch {
    return Response.json({ error: 'Cuerpo inválido.' }, { status: 400 })
  }

  if (!Array.isArray(products)) {
    return Response.json({ error: 'Se esperaba una lista de productos.' }, { status: 400 })
  }

  const buffer = await buildInventoryExport(products)
  return new Response(buffer, {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': 'attachment; filename="inventario-actual.xlsx"',
    },
  })
}

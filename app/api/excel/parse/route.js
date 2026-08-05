import { parseProductsBuffer } from '@/lib/excel'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(request) {
  let file
  try {
    const form = await request.formData()
    file = form.get('file')
  } catch {
    return Response.json({ error: 'No se pudo leer el formulario.' }, { status: 400 })
  }

  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'El archivo es demasiado grande (máx. 5 MB).' }, { status: 400 })
  }

  try {
    const buffer = await file.arrayBuffer()
    const { rows, errors } = await parseProductsBuffer(buffer)
    return Response.json({ rows, errors })
  } catch (e) {
    return Response.json(
      { error: `No se pudo leer el Excel: ${e.message}` },
      { status: 400 }
    )
  }
}

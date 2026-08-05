import ProductForm from '../../ProductForm'

export default async function EditarProductoPage({ params }) {
  const { id } = await params
  return <ProductForm productId={id} />
}

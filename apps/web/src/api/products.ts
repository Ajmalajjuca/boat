import type { LookupItem, ProductItem } from '@boat/domain/api'
import type { Product } from '@boat/domain/models'
import { api } from './client'
import { productField, productInput, toProduct } from './mappers'

export const listProducts = () =>
  api.get<{ items: ProductItem[] }>('/products').then((r) => r.items.map(toProduct))

// A product without a version is new; with one, it is an edit the server checks for conflicts.
export function saveProduct(product: Product & { version?: number }, lookups: LookupItem[]) {
  const input = productInput(product, lookups)
  const options = { fields: productField }
  return product.version === undefined
    ? api.post<ProductItem>('/products', input, options)
    : api.patch<ProductItem>(
        `/products/${product.id}`,
        { ...input, version: product.version },
        options,
      )
}
export const deleteProduct = (id: string) => api.delete(`/products/${id}`)

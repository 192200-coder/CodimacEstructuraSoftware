import { availableStock } from "../domain/rules.js"

export interface OrderStockLine {
  productId: string
  quantity: number
}

export interface ProductStock {
  id: string
  name: string
  totalStock: number
  reservedStock: number
}

export interface OrderStockFieldError {
  field: string
  code: string
  message: string
}

export function validateOrderStock(
  lines: OrderStockLine[],
  products: ProductStock[],
): OrderStockFieldError[] {
  const productsById = new Map(products.map((product) => [product.id, product]))
  return lines.flatMap((line, index) => {
    const product = productsById.get(line.productId)
    if (!product) {
      return [{
        field: `lineas[${index}].producto`,
        code: "PRODUCTO_NO_ENCONTRADO",
        message: "El producto seleccionado ya no está disponible.",
      }]
    }
    const available = availableStock(product.totalStock, product.reservedStock)
    if (line.quantity <= available) return []
    return [{
      field: `lineas[${index}].cantidad`,
      code: "STOCK_INSUFICIENTE",
      message: `Solo hay ${available} unidades disponibles de ${product.name}; faltan ${line.quantity - available}.`,
    }]
  })
}

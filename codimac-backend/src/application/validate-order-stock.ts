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

/** Al registrar se bloquea el guardado; al preparar el pedido sigue en Pendiente (RN-02). */
export type StockCheckMoment = "registro" | "preparacion"

const formatUnits = (value: number) =>
  new Intl.NumberFormat("es-PE", { maximumFractionDigits: 3 }).format(value)

export function validateOrderStock(
  lines: OrderStockLine[],
  products: ProductStock[],
  moment: StockCheckMoment = "registro",
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
    const missing = formatUnits(line.quantity - available)
    return [{
      field: `lineas[${index}].cantidad`,
      code: "STOCK_INSUFICIENTE",
      message: moment === "registro"
        ? `Solo hay ${formatUnits(available)} unidades disponibles de ${product.name}; faltan ${missing}.`
        : `Stock insuficiente: faltan ${missing} unidades de ${product.name}. El pedido sigue en Pendiente.`,
    }]
  })
}

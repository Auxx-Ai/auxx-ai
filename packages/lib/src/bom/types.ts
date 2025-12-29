import type { Part } from '@auxx/database/types'
export type Subpart = {
  id: string
  partId: string
  level: number
  part: Subpart
  quantity: number
  totalQuantity: number
  notes: string | null
}
// type SuppartItem = Pick<
//   Part,
//   'id' | 'title' | 'description' | 'sku' | 'hsCode' | 'category'
// >
export type PartCost = {
  partId: string
  cost: number
  isComposite: boolean
  contactId?: string
  contact?: {
    id: string
    name: string | null
    firstName: string | null
    lastName: string | null
  }
  subpartCosts?: Array<{
    subpartId: string
    subpart: {
      id: string
      title: string
    }
    quantity: number
    unitCost: number
    totalCost: number
  }>
  noPricing?: boolean
}
export type PartItem = Pick<
  Part,
  'id' | 'title' | 'description' | 'sku' | 'hsCode' | 'category'
> & {
  inventory?: {
    quantity: number
    location?: string
    reorderPoint?: string
    reorderQty?: number
  }
}
export type RequieredQuantity = {
  partId: string
  part: PartItem
  requiredQuantity: number
  availableQuantity: number
  shortage: number
  needsReorder: boolean
}

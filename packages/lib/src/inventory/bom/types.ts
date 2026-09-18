export type Subpart = {
  id: string
  partId: string
  level: number
  part: Subpart
  quantity: number
  totalQuantity: number
  notes: string | null
}

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
export type PartItem = {
  id: string
  title: string
  description: string | null
  sku: string
  hsCode: string | null
  category: string | null
}
export type RequieredQuantity = {
  partId: string
  part: PartItem
  requiredQuantity: number
  availableQuantity: number
  shortage: number
  needsReorder: boolean
}

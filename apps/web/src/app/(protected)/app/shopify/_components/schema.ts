import type { ProductType } from '@auxx/database/types'
import { z } from 'zod'
// We're keeping a simple non-relational schema here.
// IRL, you will have a schema for your data models.
export const orderSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  label: z.string(),
  priority: z.string(),
})
export type Order = z.infer<typeof orderSchema>
// We're keeping a simple non-relational schema here.
// IRL, you will have a schema for your data models.
export const customerSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  label: z.string(),
  priority: z.string(),
})
export type Customer = z.infer<typeof customerSchema>
// We're keeping a simple non-relational schema here.
// IRL, you will have a schema for your data models.
export const productSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  label: z.string(),
  priority: z.string(),
})
// type Product
// fix later
export type Product = ProductType
// export type Product = z.infer<typeof productSchema>

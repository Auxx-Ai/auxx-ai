// apps/web/src/components/kb/ui/settings/layout/layout-schema.ts

import { z } from 'zod'

const navigationItemSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  link: z.string().min(1, 'Link is required'),
})

export const layoutSchema = z.object({
  searchbarPosition: z.enum(['center', 'corner']).default('center'),
  headerEnabled: z.boolean().default(true),
  footerEnabled: z.boolean().default(true),
  headerNavigation: z.array(navigationItemSchema).default([]),
  footerNavigation: z.array(navigationItemSchema).default([]),
})

export type LayoutFormValues = z.infer<typeof layoutSchema>

// apps/web/src/components/kb/ui/settings/general/general-schema.ts

import { z } from 'zod'

export const generalSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
  description: z.string().optional().nullable(),
  isPublic: z.boolean().default(false),
  customDomain: z.string().optional().nullable(),

  logoDark: z.string().optional().nullable(),
  logoLight: z.string().optional().nullable(),

  theme: z.enum(['clean', 'muted', 'gradient', 'bold']).default('clean'),
  showMode: z.boolean().default(true),
  defaultMode: z.enum(['light', 'dark']).default('light'),

  primaryColorLight: z.string().optional().nullable(),
  primaryColorDark: z.string().optional().nullable(),
  tintColorLight: z.string().optional().nullable(),
  tintColorDark: z.string().optional().nullable(),
  infoColorLight: z.string().optional().nullable(),
  infoColorDark: z.string().optional().nullable(),
  successColorLight: z.string().optional().nullable(),
  successColorDark: z.string().optional().nullable(),
  warningColorLight: z.string().optional().nullable(),
  warningColorDark: z.string().optional().nullable(),
  dangerColorLight: z.string().optional().nullable(),
  dangerColorDark: z.string().optional().nullable(),

  fontFamily: z.string().optional().nullable(),
  iconsFamily: z.enum(['solid', 'regular', 'light']).default('regular'),
  cornerStyle: z.enum(['rounded', 'straight']).default('rounded'),
  sidebarListStyle: z.enum(['default', 'pill', 'line']).default('default'),
  searchbarPosition: z.enum(['center', 'corner']).default('center'),
})

export type GeneralFormValues = z.infer<typeof generalSchema>

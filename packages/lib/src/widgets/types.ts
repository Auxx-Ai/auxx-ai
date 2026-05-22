// @auxx/lib/widgets/types.ts
import { z } from 'zod'

// Widget position enum
export enum WidgetPosition {
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  TOP_RIGHT = 'TOP_RIGHT',
  TOP_LEFT = 'TOP_LEFT',
}

// Widget status enum
export enum WidgetStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// Chat widget schema for validation
export const widgetSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Widget name is required'),
  description: z.string().optional(),
  isActive: z.boolean().default(true),

  // Appearance
  title: z.string().min(1, 'Widget title is required'),
  subtitle: z.string().optional(),
  primaryColor: z.string().default('#4F46E5'),
  logoLight: z.string().nullish(),
  logoDark: z.string().nullish(),
  position: z.enum(WidgetPosition).default(WidgetPosition.BOTTOM_RIGHT),

  // Behavior
  autoOpen: z.boolean().default(false),
  mobileFullScreen: z.boolean().default(true),
  collectUserInfo: z.boolean().default(false),
  offlineMessage: z.string().optional(),

  // Domain allowlist
  allowedDomains: z.array(z.string()).default([]),

  // Optional fields for validation
  operatingHoursEnabled: z.boolean().optional(),
  timezone: z.string().optional(),
})

export type WidgetFormValues = z.infer<typeof widgetSchema>

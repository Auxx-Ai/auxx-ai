// packages/sdk/src/commands/logs/log-event.ts

import { z } from 'zod'

/**
 * Log severity levels
 */
const severitySchema = z.union([
  z.literal('INFO'),
  z.literal('WARNING'),
  z.literal('ERROR'),
  z.literal('DEBUG'),
])

export type Severity = z.infer<typeof severitySchema>

/**
 * Log event structure (already flattened by backend)
 */
export const logEventSchema = z.object({
  id: z.string(),
  message: z.string(),
  severity: severitySchema,
  timestamp: z.string(), // ISO 8601
  metadata: z.record(z.unknown()),
})

export type LogEvent = z.infer<typeof logEventSchema>

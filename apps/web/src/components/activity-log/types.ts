// apps/web/src/components/activity-log/types.ts
// Shared types for the activity-log UI. The row shape is derived from the tRPC
// router output so it stays in sync with the server without importing DB internals.

import type { RouterOutputs } from '~/trpc/react'

/** A single audit-log row, as returned by `auditLog.list` / `auditLog.listAll`. */
export type AuditLogRow = RouterOutputs['auditLog']['list']['items'][number]

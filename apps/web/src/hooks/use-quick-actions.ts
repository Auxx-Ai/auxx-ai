// apps/web/src/hooks/use-quick-actions.ts

'use client'

import type { ActionSurface } from '@auxx/lib/quick-actions/client'
import { useActionCatalog } from '~/components/apps/hooks/use-action-catalog'
import type { SerializedQuickAction } from '~/components/workflow/apps/workflow-block-loader'

/**
 * Hook to load available quick actions from installed apps.
 *
 * Thin back-compat wrapper over {@link useActionCatalog} (the centralized action
 * source). Returns the flat list — `ActionCatalogEntry` is a superset of
 * `SerializedQuickAction`, so existing consumers (`toDraftActionPayload`, the
 * email-editor picker, the `@` menu) work unchanged. Reach for `useActionCatalog`
 * directly when you also need the app-grouped view or the resolved app icon.
 *
 * See plans/kopilot/agents/triggers/app-surface-implementation-plan.md §10.2.
 */
export function useQuickActions(
  _threadId?: string,
  _ticketId?: string,
  surface?: ActionSurface
): { actions: SerializedQuickAction[]; isLoading: boolean } {
  const { actions, isLoading } = useActionCatalog({ surface })
  return { actions, isLoading }
}

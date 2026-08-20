// apps/web/src/components/workflow/hooks/use-workflow-save.ts

import {
  type PendingChanges,
  useWorkflowSaveContext,
  type WorkflowSaveApi,
} from '../providers/workflow-save-provider'

export type { PendingChanges, WorkflowSaveApi }

/**
 * Unified hook for all workflow save operations.
 *
 * A thin read of the one save owner (`WorkflowSaveProvider`, plan 22 §2 R1).
 * This used to BE the engine — pending set, 5 s debounce, conflict latch and
 * unload listeners — instantiated once per call site, ~15 times per builder
 * mount, each copy racing the others' compare-and-swap token. The API is
 * unchanged; the state behind it is now singular.
 *
 * Outside the editor (the public viewer, version previews) there is no owner
 * and this returns a no-op surface, which is what those read-only surfaces
 * already got from every save call.
 */
export const useWorkflowSave = (): WorkflowSaveApi => useWorkflowSaveContext()

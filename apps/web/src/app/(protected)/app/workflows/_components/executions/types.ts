import type { WorkflowRunStatus } from '@auxx/database/enums'
// apps/web/src/app/(protected)/app/workflows/_components/executions/types.ts
/**
 * Filter state for workflow runs
 */
export interface WorkflowRunsFilter {
  status: WorkflowRunStatus | 'all'
  startDate?: Date
  endDate?: Date
}
/**
 * Props for the main WorkflowExecutions component
 */
export interface WorkflowExecutionsProps {
  workflowId: string // WorkflowApp ID
}

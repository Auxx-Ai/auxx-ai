// packages/lib/src/workflow-engine/nodes/wait/resume-job-id.ts
// Deterministic BullMQ jobId for a wait node's delayed resume (client-notifications plan §3/
// §4.2/§7 Q — verified gap: `scheduleResume` set no jobId and nothing persisted one, so the
// only cancel path scanned the first 50 delayed jobs, `workflow-execution-service.ts:1116-1134`).
//
// Deliberately a PURE function of `(workflowRunId, nodeId)` rather than a randomly-generated id
// persisted to a new column: `WorkflowRun.pausedNodeId` already IS persisted on pause (see
// `executeWorkflowAsync`'s `WorkflowPausedException` handling), so any caller that already has
// the run id + paused node id (cancel, re-anchor) can recompute the exact same jobId without a
// schema change — the derivation itself is the "persistence". Mirrors the existing
// `approval-timeout-${approvalRequestId}` / `approval-reminder-${id}-${n}` deterministic-jobId
// convention already used by `human-confirmation.ts`/`approval-response-service.ts`.
export function buildWorkflowResumeJobId(workflowRunId: string, nodeId: string): string {
  return `resume-${workflowRunId}-${nodeId}`
}

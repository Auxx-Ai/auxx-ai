// packages/sdk/src/root/workflow/values/types.ts

/**
 * Transformation context provides entity resolution functions.
 */
export interface TransformationContext {
  /** Rule lookups */
  getRuleBySlug?: (slug: string) => Promise<{ id: string; slug: string }>
  getRuleById?: (id: string) => Promise<{ id: string; slug: string }>
  loadRule?: (id: string) => Promise<any>

  /** Workflow lookups */
  getWorkflowBySlug?: (slug: string) => Promise<{ id: string; slug: string }>
  getWorkflowById?: (id: string) => Promise<{ id: string; slug: string }>
  loadWorkflow?: (id: string) => Promise<any>

  /** Variable resolution */
  resolveVariable?: (path: string) => any
}

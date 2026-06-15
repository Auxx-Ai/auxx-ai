// packages/seed/src/domains/workflow.domain.ts
// Instantiates one workflow per example org from a bundled file template.

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { EXAMPLE_WORKFLOW_TEMPLATE_ID } from '../scenarios/example.scenario'
import type { SeedingScenario } from '../types'

const logger = createScopedLogger('workflow-domain')

/**
 * WorkflowDomain instantiates a single workflow from the bundled file template
 * for each seeded example organization. Mirrors the user-facing `workflow.create`
 * mutation: transform graph → resolve app slugs → resolve entity refs → WorkflowService.create.
 */
export class WorkflowDomain {
  /**
   * @param scenario - Scenario definition governing scale.
   * @param organizationId - Target organization.
   * @param userId - User that will own the created workflow.
   */
  constructor(
    private readonly scenario: SeedingScenario,
    private readonly organizationId: string,
    private readonly userId: string
  ) {}

  /**
   * Instantiates the "Shopify Order Lookup & Reply" workflow into the org from
   * the bundled file template registry (file templates are not stored in the DB).
   * @param db - Drizzle database instance.
   */
  async insertDirectly(db: Database): Promise<void> {
    const {
      getFileTemplateById,
      TemplateGraphTransformer,
      resolveAllAppSlugs,
      checkEntityReadiness,
      resolveEntityRefsInGraph,
      WorkflowService,
    } = await import('@auxx/lib/workflows')

    const template = getFileTemplateById(EXAMPLE_WORKFLOW_TEMPLATE_ID)
    if (!template) {
      logger.warn('Example file template missing, skipping workflow instantiation', {
        id: EXAMPLE_WORKFLOW_TEMPLATE_ID,
      })
      return
    }

    const transformer = new TemplateGraphTransformer()
    const transformed = transformer.transformTemplate(
      {
        graph: template.graph as any,
        triggerType: template.triggerType ?? undefined,
        envVars: (template.envVars ?? undefined) as any,
        variables: (template.variables ?? undefined) as any,
      },
      { userId: this.userId }
    )

    // Resolve app slug placeholders (@slug:blockId → real installed app ids)
    const requiredApps = (template.requiredApps ?? []) as Array<{ appSlug: string }>
    if (requiredApps.length > 0) {
      const appSlugs = requiredApps.map((a) => a.appSlug)
      const resolvedApps = await resolveAllAppSlugs(this.organizationId, appSlugs)
      transformer.resolveAppNodes(transformed.graph, resolvedApps)
    }

    // Resolve entity refs (@entity:slug, @field:X) where available. Unresolved refs
    // stay in the graph — matches user-facing create() and the [Example] prefix
    // signals "review before enabling".
    const requiredEntities = (template.requiredEntities ?? []) as any[]
    if (requiredEntities.length > 0) {
      const readiness = await checkEntityReadiness(this.organizationId, requiredEntities)
      resolveEntityRefsInGraph(
        transformed.graph,
        requiredEntities,
        readiness.entityIdMap,
        readiness.fieldIdMap
      )
    }

    const workflowService = new WorkflowService(db)
    await workflowService.create(this.organizationId, this.userId, {
      name: `[Example] ${template.name}`,
      description: template.description,
      enabled: false,
      graph: transformed.graph,
      triggerType: transformed.triggerType as any,
      entityDefinitionId: transformed.entityDefinitionId,
      envVars: transformed.envVars,
      variables: transformed.variables,
      icon: (template.icon ?? undefined) as any,
    })

    logger.info('Example workflow created from file template', {
      organizationId: this.organizationId,
      templateName: template.name,
    })
  }
}

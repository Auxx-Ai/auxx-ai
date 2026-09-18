// packages/lib/src/postings/delivery-coverage.ts
import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray } from 'drizzle-orm'
import { UnprocessableEntityError } from '../errors'

type Reader = Database | Transaction

/**
 * Identity of a `whole_effect` coverage row: this component IS the entire
 * effect, so it names no individual contribution lines. Mirrors the column
 * default and the CHECK in `packages/database/src/db/schema/accounting-delivery.ts`.
 */
export const WHOLE_EFFECT_COMPONENT_KEY = 'whole_effect'

/** One saved component of one effect's coverage. `lineKeys` is NULL for the whole effect. */
export interface CoverageComponent {
  componentKey: string
  lineKeys: string[] | null
}

/**
 * The partition rule that replaced `componentKey = 'whole_effect'`.
 *
 * 🛑 This is the discipline the widened CHECK gives up. While `componentKey`
 * was pinned, "one effect, one delivery" was a unique key and nothing could
 * double-send. Now that several native objects may each carry PART of one
 * effect, the same guarantee has to be an explicit rule: within one book, the
 * components of one effect must cover its accepted contribution EXACTLY ONCE.
 *
 * - **no gaps** — every `acceptedBasis.contribution[].lineKey` is carried by
 *   some component, or part of the effect silently never reaches the provider
 *   and the two ledgers differ by that amount forever
 * - **no overlap** — no line is carried twice, which is the double-send brief 44
 *   §7 requires us to prove against before sending
 * - **no strays** — a component cannot name a line the effect does not have
 * - **whole or parts, never both** — a `whole_effect` row and a partial row for
 *   the same effect is the same double-send wearing two shapes, and the
 *   `(organizationId, bookId, effectId, componentKey)` unique key cannot see it
 *
 * Returns every problem rather than the first: a caller staring at a rejected
 * plan wants the whole story.
 */
export function findCoveragePartitionProblems(input: {
  contributionLineKeys: string[]
  components: CoverageComponent[]
}): string[] {
  const problems: string[] = []
  const { components } = input
  if (!components.length) return ['Effect has no delivery coverage']

  const componentKeys = components.map((component) => component.componentKey)
  if (new Set(componentKeys).size !== componentKeys.length) problems.push('Duplicate component key')

  const whole = components.filter(
    (component) => component.componentKey === WHOLE_EFFECT_COMPONENT_KEY
  )
  if (whole.length && components.length > 1)
    problems.push('Whole-effect coverage cannot coexist with component coverage')
  for (const component of whole) {
    if (component.lineKeys !== null)
      problems.push('Whole-effect coverage must not name individual contribution lines')
  }
  if (whole.length) return problems

  const contribution = new Set(input.contributionLineKeys)
  if (!contribution.size) problems.push('Effect has no accepted contribution to partition')
  const seen = new Set<string>()
  for (const component of components) {
    if (!component.lineKeys?.length) {
      problems.push(`Component ${component.componentKey} names no contribution lines`)
      continue
    }
    for (const lineKey of component.lineKeys) {
      if (!contribution.has(lineKey))
        problems.push(`Component ${component.componentKey} names unknown line ${lineKey}`)
      else if (seen.has(lineKey)) problems.push(`Contribution line ${lineKey} is covered twice`)
      seen.add(lineKey)
    }
  }
  for (const lineKey of contribution) {
    if (!seen.has(lineKey)) problems.push(`Contribution line ${lineKey} is not covered`)
  }
  return problems
}

/** Contribution line keys of one accepted effect basis, in their frozen order. */
export function contributionLineKeys(acceptedBasis: unknown): string[] {
  const contribution = (acceptedBasis as { contribution?: unknown } | null)?.contribution
  if (!Array.isArray(contribution)) return []
  return contribution
    .map((line) => (line as { lineKey?: unknown }).lineKey)
    .filter((lineKey): lineKey is string => typeof lineKey === 'string')
}

/**
 * Prove saved coverage partitions every named effect before anything is sent.
 *
 * 🔑 Scoped by `(organizationId, bookId, effectId)` and NOT by delivery: two
 * plans splitting one effect between them is exactly the case the delivery-local
 * view cannot see. Run it under the accounting commit lock so a concurrent
 * planner cannot interleave between the read and the decision.
 *
 * ⚠️ `acceptedBasis` is only read for effects that actually have a partial
 * component. The whole-effect path — everything that exists today — costs one
 * index lookup and never touches the jsonb.
 */
export async function assertCoveragePartitionsInTx(
  tx: Reader,
  input: { organizationId: string; bookId: string; effectIds: string[] }
): Promise<void> {
  if (!input.effectIds.length) return
  const rows = await tx
    .select({
      effectId: schema.AccountingDeliveryCoverage.effectId,
      componentKey: schema.AccountingDeliveryCoverage.componentKey,
      lineKeys: schema.AccountingDeliveryCoverage.lineKeys,
    })
    .from(schema.AccountingDeliveryCoverage)
    .where(
      and(
        eq(schema.AccountingDeliveryCoverage.organizationId, input.organizationId),
        eq(schema.AccountingDeliveryCoverage.bookId, input.bookId),
        inArray(schema.AccountingDeliveryCoverage.effectId, input.effectIds)
      )
    )

  const byEffect = new Map<string, CoverageComponent[]>()
  for (const row of rows) {
    const components = byEffect.get(row.effectId) ?? []
    components.push({ componentKey: row.componentKey, lineKeys: row.lineKeys ?? null })
    byEffect.set(row.effectId, components)
  }

  // TODO(step-3): `AccountingEffect` is gone (step 1a) - a partial component's
  // contribution line keys can no longer be read back, so `lineKeysByEffect`
  // stays empty and `findCoveragePartitionProblems` reports every partial
  // component as covering an "unknown" line. Nothing writes a partial
  // component today (only `whole_effect` rows exist), so this is inert until
  // native per-line coverage returns in step 3/4.
  const lineKeysByEffect = new Map<string, string[]>()

  const problems: string[] = []
  for (const effectId of input.effectIds) {
    const components = byEffect.get(effectId) ?? []
    for (const problem of findCoveragePartitionProblems({
      contributionLineKeys: lineKeysByEffect.get(effectId) ?? [],
      components,
    })) {
      problems.push(`${effectId}: ${problem}`)
    }
  }
  if (problems.length)
    throw new UnprocessableEntityError(
      `Delivery coverage does not partition its effects: ${problems.join('; ')}`
    )
}

/**
 * Save partial component coverage for one delivery and prove the partition.
 *
 * The entry point native representations (plan 53 unit 4) write through: a
 * native Invoice and a native Payment each claim their own lines of one effect.
 * The insert and the proof share the caller's transaction, so a plan that would
 * gap or double-cover an effect never commits.
 */
export async function saveComponentCoverageInTx(
  tx: Transaction,
  input: {
    organizationId: string
    bookId: string
    deliveryId: string
    components: Array<{ effectId: string; componentKey: string; lineKeys: string[] }>
  }
): Promise<void> {
  if (!input.components.length)
    throw new UnprocessableEntityError('Component coverage requires at least one component')
  if (input.components.some((component) => component.componentKey === WHOLE_EFFECT_COMPONENT_KEY))
    throw new UnprocessableEntityError(
      'Whole-effect coverage is planned with the delivery, not saved as a component'
    )
  await tx.insert(schema.AccountingDeliveryCoverage).values(
    input.components.map((component) => ({
      organizationId: input.organizationId,
      bookId: input.bookId,
      deliveryId: input.deliveryId,
      effectId: component.effectId,
      componentKey: component.componentKey,
      lineKeys: component.lineKeys,
    }))
  )
  await assertCoveragePartitionsInTx(tx, {
    organizationId: input.organizationId,
    bookId: input.bookId,
    effectIds: [...new Set(input.components.map((component) => component.effectId))],
  })
}

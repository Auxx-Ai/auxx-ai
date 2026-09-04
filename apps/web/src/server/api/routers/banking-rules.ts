// apps/web/src/server/api/routers/banking-rules.ts
//
// Bank rules: the `bank_rule` records, suggest-from-history, and rule
// application (plans/bank-connection/03-categorization-and-gl.md §5; HANDOFF
// wave 3 slot 3C). Mounted as `bankingRules` in `root.ts` by the coordinator.
//
// 🛑 Reads are `ledgerView`; every write is `ledgerPost` - creating or editing
// a rule decides what a future line posts to, the same reasoning that puts
// the bank account mapping's own writes on `ledgerPost` (`banking.ts`).
//
// 🛑 Every refusal reaches the browser as an `AuxxError` verbatim (HANDOFF
// ground rule 9). Nothing here re-validates what the lib already refuses.

import {
  BANK_RULE_ACTIONS,
  BANK_RULE_DIRECTIONS,
  BANK_RULE_MATCH_FIELDS,
  BANK_RULE_MATCH_OPERATORS,
  createRule,
  createRuleFromTransaction,
  deleteRule,
  getBankRule,
  listBankRules,
  runSuggestionsForAccount,
  updateRule,
} from '@auxx/lib/banking/rules'
import { PermissionKey } from '@auxx/lib/permissions'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '~/server/api/trpc'

/**
 * The fields a person may set on a rule. Deliberately thin - the lib refuses
 * an unsafe regex, a code action with no GL account, or a transfer action
 * with no counterpart, each with a sentence naming what to fix; a second Zod
 * refinement here would drift from that message.
 */
const ruleFields = {
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  autoApply: z.boolean().optional(),
  priority: z.number().int().optional(),
  matchField: z.enum(BANK_RULE_MATCH_FIELDS),
  matchOperator: z.enum(BANK_RULE_MATCH_OPERATORS),
  matchValue: z.string().min(1).max(400),
  amountMinMinor: z.number().int().nonnegative().nullish(),
  amountMaxMinor: z.number().int().nonnegative().nullish(),
  direction: z.enum(BANK_RULE_DIRECTIONS).optional(),
  bankAccountId: z.string().nullish(),
  action: z.enum(BANK_RULE_ACTIONS),
  glAccountCode: z.string().max(64).nullish(),
  counterpartBankAccountId: z.string().nullish(),
  contactId: z.string().nullish(),
  memo: z.string().max(4000).nullish(),
}

export const bankingRulesRouter = createTRPCRouter({
  list: permissionProcedure(PermissionKey.ledgerView).query(async ({ ctx }) => {
    const result = await listBankRules(ctx.db, { organizationId: ctx.session.organizationId })
    if (result.isErr()) throw result.error
    return result.value
  }),

  get: permissionProcedure(PermissionKey.ledgerView)
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const result = await getBankRule(ctx.db, {
        organizationId: ctx.session.organizationId,
        ruleId: input.id,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  create: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object(ruleFields))
    .mutation(async ({ ctx, input }) => {
      const result = await createRule(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  update: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        id: z.string().min(1),
        name: ruleFields.name.optional(),
        enabled: ruleFields.enabled,
        autoApply: ruleFields.autoApply,
        priority: ruleFields.priority,
        matchField: ruleFields.matchField.optional(),
        matchOperator: ruleFields.matchOperator.optional(),
        matchValue: ruleFields.matchValue.optional(),
        amountMinMinor: ruleFields.amountMinMinor,
        amountMaxMinor: ruleFields.amountMaxMinor,
        direction: ruleFields.direction,
        bankAccountId: ruleFields.bankAccountId,
        action: ruleFields.action.optional(),
        glAccountCode: ruleFields.glAccountCode,
        counterpartBankAccountId: ruleFields.counterpartBankAccountId,
        contactId: ruleFields.contactId,
        memo: ruleFields.memo,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input
      const result = await updateRule(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ruleId: id,
        ...patch,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  delete: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteRule(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ruleId: input.id,
      })
      if (result.isErr()) throw result.error
      return { ok: true as const }
    }),

  /** "Create rule from this" - the code panel's toggle (ui-plan.md §2.8 item 4). */
  createFromTransaction: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        transactionId: z.string().min(1),
        glAccountCode: z.string().min(1).max(64),
        name: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createRuleFromTransaction(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        ...input,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Run rule evaluation and suggest-from-history over every `for_review`
   * line, optionally scoped to one account. The Rules tab's "Run suggestions
   * now" button, and the entry point 3A's connector and 3D's import call
   * after a sync or a batch.
   */
  runSuggestions: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ bankAccountId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await runSuggestionsForAccount(ctx.db, {
        organizationId: ctx.session.organizationId,
        actorUserId: ctx.session.userId,
        bankAccountId: input.bankAccountId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),
})

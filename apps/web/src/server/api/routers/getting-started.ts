// apps/web/src/server/api/routers/getting-started.ts
// Slim router for the getting-started checklists (org-wide `main` + module
// checklists like `dispatch`) — all logic lives in @auxx/lib/getting-started.
// Each procedure just builds the lib ctx and delegates.

import {
  CHECKLIST_IDS,
  completeAllGoals,
  getGettingStartedStatus,
  isGoalKey,
  markGoalComplete,
  setDismissed,
  setWizardCompleted,
} from '@auxx/lib/getting-started'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const checklistSchema = z.enum(CHECKLIST_IDS)

/** Narrow a string to a goal key valid for `checklist`, or throw `BAD_REQUEST`. */
function requireGoalKey(checklist: (typeof CHECKLIST_IDS)[number], key: string) {
  if (!isGoalKey(checklist, key)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `"${key}" is not a valid goal for the "${checklist}" checklist`,
    })
  }
  return key
}

export const gettingStartedRouter = createTRPCRouter({
  /** Resolved checklist status: completed goal keys + dismissal + wizard flag. */
  getStatus: protectedProcedure
    .input(z.object({ checklist: checklistSchema.default('main') }).optional())
    .query(({ ctx, input }) =>
      getGettingStartedStatus(
        { db: ctx.db, organizationId: ctx.session.organizationId },
        input?.checklist ?? 'main'
      )
    ),

  /** Mark a single goal complete (e.g. the extension step). */
  markGoalComplete: protectedProcedure
    .input(z.object({ checklist: checklistSchema.default('main'), key: z.string() }))
    .mutation(({ ctx, input }) =>
      markGoalComplete(
        { db: ctx.db, organizationId: ctx.session.organizationId },
        input.checklist,
        requireGoalKey(input.checklist, input.key)
      )
    ),

  /** "Mark all" — union the displayed goal keys into manual completions. */
  completeAll: protectedProcedure
    .input(z.object({ checklist: checklistSchema.default('main'), keys: z.array(z.string()) }))
    .mutation(({ ctx, input }) => {
      const keys = input.keys.map((key) => requireGoalKey(input.checklist, key))
      return completeAllGoals(
        { db: ctx.db, organizationId: ctx.session.organizationId },
        input.checklist,
        keys
      )
    }),

  /** Dismiss or un-dismiss the widget. */
  setDismissed: protectedProcedure
    .input(z.object({ checklist: checklistSchema.default('main'), dismissed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setDismissed(
        { db: ctx.db, organizationId: ctx.session.organizationId },
        input.checklist,
        input.dismissed
      )
    ),

  /** Stamp the setup wizard as finished or skipped — never auto-opens again. */
  setWizardCompleted: protectedProcedure
    .input(z.object({ checklist: checklistSchema.default('main') }))
    .mutation(({ ctx, input }) =>
      setWizardCompleted(
        { db: ctx.db, organizationId: ctx.session.organizationId },
        input.checklist
      )
    ),
})

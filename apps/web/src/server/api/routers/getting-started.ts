// apps/web/src/server/api/routers/getting-started.ts
// Slim router for the getting-started checklist — all logic lives in
// @auxx/lib/getting-started. Each procedure just builds the lib ctx and delegates.

import {
  completeAllGoals,
  GOAL_KEYS,
  getGettingStartedStatus,
  markGoalComplete,
  setDismissed,
} from '@auxx/lib/getting-started'
import { z } from 'zod'
import { createTRPCRouter, protectedProcedure } from '~/server/api/trpc'

const goalKeySchema = z.enum(GOAL_KEYS)

export const gettingStartedRouter = createTRPCRouter({
  /** Resolved checklist status: completed goal keys + dismissal flag. */
  getStatus: protectedProcedure.query(({ ctx }) =>
    getGettingStartedStatus({ db: ctx.db, organizationId: ctx.session.organizationId })
  ),

  /** Mark a single goal complete (e.g. the extension step). */
  markGoalComplete: protectedProcedure
    .input(z.object({ key: goalKeySchema }))
    .mutation(({ ctx, input }) =>
      markGoalComplete({ db: ctx.db, organizationId: ctx.session.organizationId }, input.key)
    ),

  /** "Mark all" — union the displayed goal keys into manual completions. */
  completeAll: protectedProcedure
    .input(z.object({ keys: z.array(goalKeySchema) }))
    .mutation(({ ctx, input }) =>
      completeAllGoals({ db: ctx.db, organizationId: ctx.session.organizationId }, input.keys)
    ),

  /** Dismiss or un-dismiss the widget. */
  setDismissed: protectedProcedure
    .input(z.object({ dismissed: z.boolean() }))
    .mutation(({ ctx, input }) =>
      setDismissed({ db: ctx.db, organizationId: ctx.session.organizationId }, input.dismissed)
    ),
})

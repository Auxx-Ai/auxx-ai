// packages/lib/src/ai/kopilot/prompts/sections/caller-preamble.ts

import type { AgentSurface } from '../../../../agents/client'
import { type Audience, INTERACTIVE_ONLY, type PromptSection } from './types'

const BUILDER_SURFACE: ReadonlySet<AgentSurface> = new Set(['builder'])

/**
 * Member audience only.
 *
 * Not a formatting concern (that's `surface`) — a customer-audience turn has no
 * member caller to name. Chat is the concrete case: `build-chat-engine-config`
 * runs the turn as the *agent's* user, so `currentUser` there is the agent's own
 * member row, and announcing it as "the caller" would be flatly wrong on top of
 * leaking an internal actorId to a customer-facing prompt (see {@link Audience}).
 */
const MEMBER_AUDIENCE: ReadonlySet<Audience> = new Set(['member'])

/**
 * Who the model is working for this turn — name, email, and `actorId`.
 *
 * The `actorId` is the load-bearing part: "assign this to me", "what's assigned
 * to me", "my open threads" are unanswerable without it, and tools take actor
 * ids, not names. It therefore renders on **every** interactive member-facing
 * surface, not just the agent builder.
 *
 * Only the *mention syntax* is surface-specific: `[name](auxx://actor/<id>)`
 * is the in-app renderer's link form, so it is offered on `builder` alone —
 * chat and email render it literally (chat has its own plain-text rule in
 * `chat-formatting.ts`). Every surface still gets the raw ids.
 *
 * `INTERACTIVE_ONLY`: an autonomous trigger run has no caller — `triggerActingAs`
 * covers the run-as identity there.
 */
export const callerPreamble: PromptSection = {
  id: 'caller-preamble',
  modes: INTERACTIVE_ONLY,
  audiences: MEMBER_AUDIENCE,
  stability: 'turn',
  render: (ctx) => {
    const user = ctx.currentUser
    if (!user) return null

    const displayName = user.name ?? user.email ?? user.userId
    const emailSuffix = user.name && user.email ? ` <${user.email}>` : ''
    const identity = `The **caller**: ${displayName}${emailSuffix} — actorId \`${user.actorId}\`, role ${user.role}.`

    const mention = BUILDER_SURFACE.has(ctx.surface)
      ? ` Mention them in prose as \`[${displayName}](auxx://actor/${user.actorId})\`.`
      : ''

    return `## Who you're helping

${identity}${mention}

"me", "my", "mine", "assigned to me" and "I" all mean this person — resolve them to actorId \`${user.actorId}\` when calling a tool. Never guess a different member.`
  },
}

// packages/lib/src/ai/kopilot/capabilities/purchasing-intake/tools/propose-draft.ts

import { isRecordId, type RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import type {
  IntakeDraftPayload,
  IntakeFold,
  IntakeLine,
} from '../../../../../purchasing/intake/client'
import { parseIntakeMoney, unresolvedLines } from '../../../../../purchasing/intake/client'
import { markIntakeDraftReady } from '../../../../../purchasing/intake/draft-mutations'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { refuseUnlessDefViewable, resolveIntakeSession } from './intake-session'

const FOLD_TARGETS: readonly IntakeFold[] = ['shipping', 'tax']

const ProposeDraftOutput = z.object({
  draftId: z.string(),
  lineCount: z.number(),
  orderableCount: z.number(),
  foldedCount: z.number(),
  needsPartCount: z.number(),
  reviewUrl: z.string(),
})

/** One per-line decision the model makes. Nothing transcribed appears here. */
interface LineDecisionArg {
  lineId?: string
  partRecordId?: string | null
  foldedInto?: string | null
  chosenBreakIndex?: number | null
}

/**
 * The turn's last act: stage the whole proposal onto the draft row.
 *
 * ✅ `endsTurn: true` is what dissolves Q-7 here. A tool marked terminal
 * finalizes the turn without re-invoking the LLM, so **the tool's arguments ARE
 * the structured output** — validated by `tool-bridge.ts`, with no
 * `run-structured-output-pass` anywhere in this path (§1.2 / §4.3).
 * `suggest-replies.ts` is the precedent.
 *
 * 🛑 Its permission descriptor is `view` on `purchase_order`, **not** `create`.
 * It writes a draft, and a draft is not a purchase order: it has no number, it
 * appears in no list, and nothing downstream reads it until a person presses a
 * button on the review screen (§6.1 / §6.3).
 *
 * 🛑 The arguments are DECISIONS, never transcription. Part, fold, price break —
 * that is the whole surface. Description, quantity, unit price, breaks and
 * totals are read from the line the transcriber produced and `resolve_lines`
 * stamped, and tier/candidates are carried through untouched so the review
 * screen's "why did this link" is server-authored rather than model-asserted.
 */
export function createProposeDraftTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'propose_draft',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: '`canViewEntity` on the `purchase_order` def — VIEW, not create: this writes the intake draft row, which is not a purchase order and mints no number. The create gate (`assertEditEntity`) sits on `purchasing.commitIntakeDraft`, where a human presses the button (§4.3 / §6.3). The draft itself is resolved from the `intakeDraft` session ref, so there is no draftId argument to aim at another org.',
    },
    displayName: 'Propose purchase order draft',
    // Terminal by construction: the arguments are the artifact, so there is
    // nothing left for the model to say after a successful call.
    endsTurn: true,
    description: `Stage the finished proposal on the draft and end the turn.

Call this exactly ONCE, last, after \`resolve_lines\` has run. Supply only the
DECISIONS — everything the vendor printed is already on the draft and is read
from there:

- \`header.vendorRecordId\` — the company you picked from \`search_entities\`.
- \`lines[].partRecordId\` — the part for a line the ladder left unresolved, or
  a correction to one it linked. Leave it out to keep the ladder's answer.
- \`lines[].foldedInto\` — \`shipping\` or \`tax\` for a line that is not an ordered
  part (freight, a small-order surcharge, tooling, packaging). Its amount moves
  to the header total and the row leaves the table.
- \`lines[].chosenBreakIndex\` — which printed quantity break applies, as an index
  into that line's break table.

Do NOT re-type descriptions, quantities, prices, or totals: they are already
transcribed, and a second pass over the same number is how a price stops matching
the paper it came from.

A line you cannot resolve is fine — leave it unresolved and say so in your reply.
A person finishes it on the review screen; nothing is committed here.`,
    parameters: {
      type: 'object',
      properties: {
        header: {
          type: 'object',
          properties: {
            vendorRecordId: {
              type: ['string', 'null'],
              description:
                'RecordId of the COMPANY this quote came from, verbatim from a search result, or null when none matched.',
            },
            currency: {
              type: 'string',
              description: 'ISO 4217 override. Omit to keep the currency already on the draft.',
            },
            quoteNumber: {
              type: ['string', 'null'],
              description: "The vendor's own quote number. Omit to keep the transcribed value.",
            },
            quoteDate: {
              type: ['string', 'null'],
              description: 'ISO date. Omit to keep the transcribed value.',
            },
            expectedDeliveryDate: {
              type: ['string', 'null'],
              description:
                'ISO date implied by the quoted lead times, or null when the quote states none.',
            },
          },
          required: ['vendorRecordId'],
          additionalProperties: false,
        },
        lines: {
          type: 'array',
          description:
            'Per-line decisions, keyed by the `lineId` `resolve_lines` returned. Omit a line entirely to accept the ladder’s answer unchanged.',
          items: {
            type: 'object',
            properties: {
              lineId: {
                type: 'string',
                description: 'The `lineId` from `resolve_lines`. Copy it verbatim.',
              },
              partRecordId: {
                type: ['string', 'null'],
                description:
                  'RecordId of the part this line orders. Null clears a link you disagree with.',
              },
              foldedInto: {
                type: ['string', 'null'],
                enum: ['shipping', 'tax', null],
                description:
                  'Move this line’s amount to a header total instead of ordering it as a part.',
              },
              chosenBreakIndex: {
                type: ['number', 'null'],
                description:
                  'Index into this line’s printed price-break table. Null uses the base printed price.',
              },
            },
            required: ['lineId'],
            additionalProperties: false,
          },
        },
      },
      required: ['header', 'lines'],
      additionalProperties: false,
    },
    outputSchema: ProposeDraftOutput,
    execute: async (args, agentDeps) => {
      const resolved = await resolveIntakeSession(getDeps, agentDeps)
      if (!resolved.ok) return { success: false, output: null, error: resolved.error }
      const { organizationId, capabilities, draftId, payload } = resolved.session

      const refusal = await refuseUnlessDefViewable(organizationId, capabilities, 'purchase_order')
      if (refusal) return { success: false, output: null, error: refusal }

      if (!payload || payload.lines.length === 0) {
        return {
          success: false,
          output: null,
          error:
            'This draft has no resolved lines yet. Call `resolve_lines` for the whole quote first — its answer is what carries the tier and the candidates onto the draft.',
        }
      }

      const header = (args.header ?? {}) as Record<string, unknown>

      let vendorRecordId: RecordId | null = null
      const rawVendor = header.vendorRecordId
      if (typeof rawVendor === 'string' && rawVendor.length > 0) {
        if (!isRecordId(rawVendor)) {
          return {
            success: false,
            output: null,
            error: `"${rawVendor}" is not a RecordId. Copy the \`recordId\` a search tool returned, verbatim.`,
          }
        }
        vendorRecordId = rawVendor
      }

      const currency =
        typeof header.currency === 'string' && header.currency.trim()
          ? header.currency.trim().toUpperCase()
          : payload.currency

      const decisions = new Map<string, LineDecisionArg>()
      const unknown: string[] = []
      const known = new Set(payload.lines.map((line) => line.lineId))
      for (const entry of (Array.isArray(args.lines) ? args.lines : []) as LineDecisionArg[]) {
        if (!entry || typeof entry.lineId !== 'string') continue
        if (!known.has(entry.lineId)) {
          unknown.push(entry.lineId)
          continue
        }
        decisions.set(entry.lineId, entry)
      }
      if (unknown.length > 0) {
        // A lineId the draft never issued means the model invented one. Refusing
        // is the only safe answer: silently dropping it would stage a proposal
        // that omits a decision the model believes it made.
        return {
          success: false,
          output: null,
          error: `Unknown lineId(s): ${unknown.join(', ')}. Use the \`lineId\` values \`resolve_lines\` returned, verbatim.`,
        }
      }

      const merged: IntakeLine[] = []
      for (const line of payload.lines) {
        const decision = decisions.get(line.lineId)
        if (!decision) {
          merged.push(line)
          continue
        }

        let partRecordId = line.partRecordId
        if (decision.partRecordId === null) {
          partRecordId = null
        } else if (typeof decision.partRecordId === 'string' && decision.partRecordId.length > 0) {
          if (!isRecordId(decision.partRecordId)) {
            return {
              success: false,
              output: null,
              error: `Line ${line.lineId}: "${decision.partRecordId}" is not a RecordId.`,
            }
          }
          partRecordId = decision.partRecordId
        }

        let foldedInto = line.foldedInto
        if (decision.foldedInto === null) {
          foldedInto = null
        } else if (typeof decision.foldedInto === 'string') {
          if (!FOLD_TARGETS.includes(decision.foldedInto as IntakeFold)) {
            return {
              success: false,
              output: null,
              error: `Line ${line.lineId}: \`foldedInto\` must be "shipping", "tax", or null.`,
            }
          }
          foldedInto = decision.foldedInto as IntakeFold
        }

        let chosenBreakIndex = line.chosenBreakIndex
        let unitPriceCents = line.unitPriceCents
        if (decision.chosenBreakIndex === null) {
          chosenBreakIndex = null
          unitPriceCents = parseIntakeMoney(line.printed.unitPriceText, currency)
        } else if (typeof decision.chosenBreakIndex === 'number') {
          const chosen = line.printed.priceBreaks[decision.chosenBreakIndex]
          if (!chosen) {
            return {
              success: false,
              output: null,
              error: `Line ${line.lineId}: price break ${decision.chosenBreakIndex} does not exist; that line printed ${line.printed.priceBreaks.length}.`,
            }
          }
          chosenBreakIndex = decision.chosenBreakIndex
          // Picking a break rewrites `expectedUnitPrice` and nothing else (§6.2),
          // and the price still comes from the vendor's own printed string.
          unitPriceCents = parseIntakeMoney(chosen.unitPriceText, currency)
        }

        // 🛑 A folded line is not an ordered part, so its part link goes with it.
        // Leaving one behind would keep it in `orderableLines` on the next read.
        if (foldedInto !== null) partRecordId = null

        merged.push({ ...line, partRecordId, foldedInto, chosenBreakIndex, unitPriceCents })
      }

      const printedShipping = parseIntakeMoney(payload.transcription.shippingText, currency) ?? 0
      const printedTax = parseIntakeMoney(payload.transcription.taxText, currency) ?? 0
      const shippingCents = printedShipping + foldedTotalCents(merged, 'shipping', currency)
      const taxCents = printedTax + foldedTotalCents(merged, 'tax', currency)

      const next: IntakeDraftPayload = {
        ...payload,
        vendorRecordId,
        currency,
        lines: merged,
        quoteNumber: pickText(header.quoteNumber, payload.quoteNumber),
        quoteDate: pickText(header.quoteDate, payload.quoteDate),
        expectedDeliveryDate: pickText(header.expectedDeliveryDate, payload.expectedDeliveryDate),
        shippingCents,
        taxCents,
      }

      const written = await markIntakeDraftReady(organizationId, draftId, next)
      if (written.isErr()) {
        return { success: false, output: null, error: written.error.message }
      }

      const orderable = merged.filter((line) => line.foldedInto === null)
      return {
        success: true,
        output: {
          draftId,
          lineCount: merged.length,
          orderableCount: orderable.length,
          foldedCount: merged.length - orderable.length,
          needsPartCount: unresolvedLines(merged).length,
          reviewUrl: `/app/purchase-orders/intake/${draftId}`,
        },
      }
    },
  }
}

/**
 * What a folded line contributes to a header total.
 *
 * The vendor's printed line total wins when there is one; otherwise the price
 * times the quantity. Nothing here reconciles against the vendor's printed
 * grand total — §3.1's confrontation shows that disagreement rather than
 * quietly correcting their arithmetic.
 */
function foldedTotalCents(lines: IntakeLine[], target: IntakeFold, currency: string): number {
  let sum = 0
  for (const line of lines) {
    if (line.foldedInto !== target) continue
    const printed = parseIntakeMoney(line.printed.lineTotalText, currency)
    if (printed !== null) {
      sum += printed
      continue
    }
    if (line.unitPriceCents !== null) sum += Math.round(line.unitPriceCents * line.quantity)
  }
  return sum
}

/** An explicit header value wins; anything absent keeps what the draft holds. */
function pickText(supplied: unknown, fallback: string | null): string | null {
  if (supplied === null) return null
  if (typeof supplied === 'string') {
    const trimmed = supplied.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return fallback
}

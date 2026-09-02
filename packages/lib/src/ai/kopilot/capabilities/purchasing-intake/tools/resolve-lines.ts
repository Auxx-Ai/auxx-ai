// packages/lib/src/ai/kopilot/capabilities/purchasing-intake/tools/resolve-lines.ts

import { isRecordId, type RecordId } from '@auxx/types/resource'
import { z } from 'zod'
import type { IntakeDraftPayload, TranscribedLine } from '../../../../../purchasing/intake/client'
import { isAutoLinkTier } from '../../../../../purchasing/intake/client'
import { updateIntakeDraftPayload } from '../../../../../purchasing/intake/draft-mutations'
import { resolveQuoteLines } from '../../../../../purchasing/intake/resolve'
import type { AgentToolDefinition } from '../../../../agent-framework/types'
import type { GetToolDeps } from '../../types'
import { refuseUnlessDefViewable, resolveIntakeSession, tierConfidence } from './intake-session'

/** A quote longer than this is a data-entry accident, not a quote. */
const MAX_LINES = 250
/** Candidates the model is shown per line. Beyond this it is guessing anyway. */
const MAX_CANDIDATES_PER_LINE = 5

const ResolveLinesOutput = z.object({
  vendorRecordId: z.string().nullable(),
  currency: z.string(),
  lines: z.array(
    z.object({
      lineId: z.string(),
      lineNumber: z.number().nullable(),
      vendorCode: z.string().nullable(),
      description: z.string().nullable(),
      quantity: z.number(),
      tier: z.string(),
      confidence: z.enum(['high', 'medium', 'low', 'none']),
      autoLinked: z.boolean(),
      partRecordId: z.string().nullable(),
      vendorPartRecordId: z.string().nullable(),
      candidates: z.array(
        z.object({
          recordId: z.string(),
          displayName: z.string(),
          secondary: z.string().nullable(),
          tier: z.string(),
        })
      ),
    })
  ),
  summary: z.object({
    total: z.number(),
    autoLinked: z.number(),
    needsReview: z.number(),
    unmatched: z.number(),
  }),
})

/** One matching-input override the model may supply. Money is deliberately absent. */
interface LineOverrideArg {
  lineNumber?: number | null
  vendorCode?: string | null
  description?: string | null
  quantity?: number | null
  unit?: string | null
}

/**
 * Run the whole quote's line array through the deterministic tier ladder in one
 * call, and stamp the answer onto the draft.
 *
 * 🛑 This tool exists for two reasons a generic read tool cannot cover, and
 * neither of them is the query (§4.2):
 *
 *  1. **Batching.** Forty lines against three tiers is up to 120 `query_records`
 *     round trips inside a loop capped at `maxIterations: 30`. It does not fit.
 *  2. **Provenance.** §6 has to show *why* a line linked, and §5.3's write-back
 *     only fires on a tier-3/4 line a human resolved. If the model issued three
 *     `query_records` calls and picked a winner, nothing would record which call
 *     produced the link.
 *
 * ⚠️ It is implemented OVER the existing readers — `resolveQuoteLines` calls the
 * same `(part, supplier)` path `findVendorPartForLine` does. A second
 * hand-rolled `vendor_part` query would drift from that one the first time
 * either changed.
 *
 * The resolution is written into the draft payload so `propose_draft` can merge
 * the model's *decisions* onto server-authored tiers and candidates. The model
 * never re-types a tier, which is what keeps the provenance above honest.
 */
export function createResolveLinesTool(getDeps: GetToolDeps): AgentToolDefinition {
  return {
    name: 'resolve_lines',
    permission: {
      target: 'definition',
      level: 'view',
      enforcement: 'enforced',
      note: '`canViewEntity` on the `part` def before the ladder runs, plus the draft is resolved from the `intakeDraft` session ref under the caller’s organizationId — there is no draftId argument to aim at another org. Refuses outright (rather than reading empty) because a silently unresolved quote is worse than a named refusal.',
    },
    displayName: 'Match quote lines to parts',
    description: `Match every line of the vendor's quote to one of our parts, in one call.

Runs the deterministic ladder per line and returns the tier that matched:
- \`vendor_sku\` — this vendor's catalogue lists that code for one of our parts. Strongest.
- \`sku\` — our own part SKU equals the printed code. Exact, but VENDOR-BLIND: two
  vendors can print our SKU for different goods, so it is a weaker match than \`vendor_sku\`.
- \`fuzzy\` — a normalized title/description match. NEVER auto-links; a human picks.
- \`none\` — nothing matched. The line needs a part created, folding into shipping/tax,
  or dropping. It cannot be committed description-only.

Call this ONCE with the whole line array — not per line. Resolve the vendor first
with \`search_entities\` against COMPANIES and pass the winner as \`vendorRecordId\`;
tier 1 cannot fire without it.

Omit \`lines\` to run the ladder over the transcription already on the draft — that
is the normal case. Supply \`lines\` only to correct a mis-read code or description.
Prices, totals and quantity breaks are read from the transcription either way and
are never arguments here: re-typing a price is how a number stops matching the
paper it came from.`,
    parameters: {
      type: 'object',
      properties: {
        vendorRecordId: {
          type: ['string', 'null'],
          description:
            'RecordId of the COMPANY this quote came from (`<defId>:<instanceId>`), or null when no vendor was identified. A purchase order is placed with an organisation, never a person. Tier 1 is vendor-scoped and cannot fire without it.',
        },
        currency: {
          type: 'string',
          description:
            'ISO 4217 code the quote is priced in. Optional — defaults to the currency on the draft.',
        },
        lines: {
          type: 'array',
          maxItems: MAX_LINES,
          description:
            'Optional matching-input overrides, merged onto the transcribed line with the same `lineNumber`. Omit entirely to use the transcription as read.',
          items: {
            type: 'object',
            properties: {
              lineNumber: {
                type: ['number', 'null'],
                description: 'The printed line number this entry overrides.',
              },
              vendorCode: { type: ['string', 'null'] },
              description: { type: ['string', 'null'] },
              quantity: { type: ['number', 'null'] },
              unit: { type: ['string', 'null'] },
            },
            required: ['lineNumber'],
            additionalProperties: false,
          },
        },
      },
      required: ['vendorRecordId'],
      additionalProperties: false,
    },
    outputSchema: ResolveLinesOutput,
    execute: async (args, agentDeps) => {
      const resolved = await resolveIntakeSession(getDeps, agentDeps)
      if (!resolved.ok) return { success: false, output: null, error: resolved.error }
      const { db, organizationId, capabilities, draftId, payload } = resolved.session

      const refusal = await refuseUnlessDefViewable(organizationId, capabilities, 'part')
      if (refusal) return { success: false, output: null, error: refusal }

      if (!payload) {
        return {
          success: false,
          output: null,
          error:
            'This draft has no transcription yet, so there is nothing to match. The document read has not finished.',
        }
      }

      const rawVendor = args.vendorRecordId
      let vendorRecordId: RecordId | null = null
      if (typeof rawVendor === 'string' && rawVendor.length > 0) {
        if (!isRecordId(rawVendor)) {
          return {
            success: false,
            output: null,
            error: `"${rawVendor}" is not a RecordId. Pass the \`recordId\` a search tool returned, verbatim (\`<entityDefinitionId>:<instanceId>\`).`,
          }
        }
        vendorRecordId = rawVendor
      }

      const currency =
        (typeof args.currency === 'string' && args.currency.trim()
          ? args.currency.trim().toUpperCase()
          : null) ??
        payload.currency ??
        payload.transcription.currency
      if (!currency) {
        return {
          success: false,
          output: null,
          error:
            'The quote names no currency and the draft carries none. Supply `currency` as an ISO 4217 code.',
        }
      }

      const lines = mergeOverrides(payload.transcription.lines, args.lines)
      if (lines.length === 0) {
        return {
          success: false,
          output: null,
          error: 'The transcription has no lines, so there is nothing to match.',
        }
      }
      if (lines.length > MAX_LINES) {
        return {
          success: false,
          output: null,
          error: `This quote has ${lines.length} lines; ${MAX_LINES} is the cap.`,
        }
      }

      const result = await resolveQuoteLines(db, organizationId, {
        vendorRecordId,
        currency,
        lines,
      })
      if (result.isErr()) {
        return { success: false, output: null, error: result.error.message }
      }
      const resolvedLines = result.value

      // Stamp the answer onto the draft. This is the draft row, not a record:
      // nothing downstream reads it until a person presses a button (§6.1).
      const next: IntakeDraftPayload = {
        ...payload,
        vendorRecordId,
        currency,
        lines: resolvedLines,
      }
      const written = await updateIntakeDraftPayload(organizationId, draftId, next)
      if (written.isErr()) {
        return { success: false, output: null, error: written.error.message }
      }

      const view = resolvedLines.map((line) => ({
        lineId: line.lineId,
        lineNumber: line.printed.lineNumber,
        vendorCode: line.printed.vendorCode,
        description: line.description ?? line.printed.description,
        quantity: line.quantity,
        tier: line.tier,
        confidence: tierConfidence(line.tier),
        autoLinked: isAutoLinkTier(line.tier) && line.partRecordId !== null,
        partRecordId: line.partRecordId,
        vendorPartRecordId: line.vendorPartRecordId,
        candidates: line.candidates.slice(0, MAX_CANDIDATES_PER_LINE).map((candidate) => ({
          recordId: candidate.recordId,
          displayName: candidate.displayName,
          secondary: candidate.secondary,
          tier: candidate.tier,
        })),
      }))

      return {
        success: true,
        output: {
          vendorRecordId,
          currency,
          lines: view,
          summary: {
            total: view.length,
            autoLinked: view.filter((l) => l.autoLinked).length,
            needsReview: view.filter((l) => l.tier === 'fuzzy').length,
            unmatched: view.filter((l) => l.tier === 'none').length,
          },
        },
      }
    },
  }
}

/**
 * Layer the model's matching-input overrides onto the transcribed lines.
 *
 * 🛑 Only the ladder's INPUTS are overridable — code, description, quantity,
 * unit. Every money field and the quantity-break table come from the
 * transcription unconditionally, so a printed price can never be re-typed by a
 * second pass over the same document (§1.2).
 */
function mergeOverrides(printed: TranscribedLine[], raw: unknown): TranscribedLine[] {
  if (!Array.isArray(raw) || raw.length === 0) return printed
  const overrides = new Map<number | null, LineOverrideArg>()
  for (const entry of raw as LineOverrideArg[]) {
    if (entry && typeof entry === 'object') overrides.set(entry.lineNumber ?? null, entry)
  }
  return printed.map((line) => {
    const override = overrides.get(line.lineNumber)
    if (!override) return line
    return {
      ...line,
      vendorCode: override.vendorCode !== undefined ? override.vendorCode : line.vendorCode,
      description: override.description !== undefined ? override.description : line.description,
      quantity: override.quantity !== undefined ? override.quantity : line.quantity,
      unit: override.unit !== undefined ? override.unit : line.unit,
    }
  })
}

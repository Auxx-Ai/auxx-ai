// packages/lib/src/returns/intake/transcribe.ts

/**
 * Step 1 of the return-intake pipeline (plans/money/tasks/57 §3): a photograph of
 * a return label in, the label as printed out.
 *
 * ONE `LLMOrchestrator.invoke`, no tools, the image as a content block, a JSON
 * schema on the way back. The reasons that shape is not negotiable:
 *
 * 🛑 **No tool loop.** Tools and structured output cannot share a call, so a loop
 * would force `image -> prose -> second model -> JSON`
 * (`run-structured-output-pass.ts`), and the second model never sees the photo.
 * Every address line would be transcribed twice, the second time blind. §2.1
 * also records why there is no `returns.intake` Kopilot capability at all: a
 * label has one sender, one carrier and one tracking number, so there is nothing
 * for a loop to iterate over.
 *
 * 🛑 **No extractor, and no `prepareDocument`.** Unlike the vendor-quote sibling
 * (`purchasing/intake/transcribe.ts`, which branches into `ExtractorFactory` for
 * xlsx and docx), this path has exactly one input shape: a dock photo, which is
 * a JPEG or a HEIC from a phone, or a PDF a carrier portal produced.
 * `isSupportedFileMimeType` admits both natively, so there is no conversion step
 * to get wrong — and converting a label to text would destroy the one thing a
 * label is, which is a layout. §3.3.
 *
 * ⚠️ **One call per label.** This function transcribes ONE label. Batching n of m
 * is the job's business (§3.4), and sending ten images in one call is explicitly
 * refused by §3.1: the model would have to keep ten (image → object) bindings
 * straight, and a single mis-ordering silently assigns one customer's address to
 * another customer's parcel — the exact error this feature exists to prevent,
 * made invisible.
 *
 * Nothing here writes. The draft row is the job's business; this returns a value.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { parseFileRef } from '@auxx/types/file-ref'
import type { Result } from 'neverthrow'
import { LLMClient } from '../../ai/clients/base/llm-client'
import type { MultiModalContent } from '../../ai/clients/base/types'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import { ProviderRegistry } from '../../ai/providers/provider-registry'
import { ModelType } from '../../ai/providers/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { getCachedDefaultModel } from '../../cache/org-cache-helpers'
import type { AuxxError } from '../../errors'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { getAsset } from '../../files/assets/asset-queries'
import { getAssetContent } from '../../files/assets/content'
import { createS3StoragePort } from '../../files/storage/ports'
import { resolveCapabilityGates } from '../../workflow-engine/nodes/utils/model-capability-gates'
import type { TranscribedLabel } from './client'
import { guard } from './guard'
import {
  parseTranscribedLabel,
  TRANSCRIBE_LABEL_PROMPT,
  TRANSCRIBED_LABEL_JSON_SCHEMA,
} from './schema'

const logger = createScopedLogger('returns:intake:transcribe')

/** Same fallback pair `purchasing/intake/transcribe.ts` uses. */
const FALLBACK_PROVIDER = 'openai'
const FALLBACK_MODEL = 'gpt-5.4-nano'

/**
 * The `AiUsage.source` label this spend lands under.
 *
 * ⚠️ Not a member of the `UsageSource` union in `ai/orchestrator/types.ts` yet —
 * `context.source` is typed `string` and the orchestrator casts it, so this
 * compiles and writes the right label, but the union is what keeps the
 * vocabulary queryable. Adding the arm is a one-line edit in a file this module
 * does not own; see this build's handoff.
 */
const USAGE_SOURCE = 'return_intake'

/** What the capability gate decided, in the shape the dialog's gate page renders. */
export interface ReturnIntakeModelCapability {
  ok: boolean
  modelId: string
  /** Why not, naming the model. `null` when `ok`. */
  reason: string | null
}

async function resolveModel(organizationId: string): Promise<{ provider: string; model: string }> {
  const configured = await getCachedDefaultModel(organizationId, ModelType.LLM)
  return {
    provider: configured?.provider ?? FALLBACK_PROVIDER,
    model: configured?.model ?? FALLBACK_MODEL,
  }
}

/**
 * Can this org's default model read a photograph at all?
 *
 * 🛑 Exposed as its own export because the dialog asks it **on open**, before a
 * file is picked (§7.2). Refusing after a worker has walked to the dock and
 * photographed twenty parcels is the bad version of the same refusal, and a
 * model that cannot see must produce a message a person can act on — "pick
 * another default model" — rather than twenty silently empty transcriptions.
 *
 * Three gates, all fatal:
 *
 * - `skipStructuredOutput` — a transcription that cannot return JSON is not a
 *   degraded transcription, it is prose.
 * - `skipFiles` — the model takes no attachments of any kind.
 * - 🔀 **`supports.vision === false`** — checked separately, and this is where
 *   this gate is deliberately STRICTER than `checkIntakeModelCapability`.
 *   `resolveCapabilityGates` only raises `skipFiles` when `vision` **and**
 *   `fileInput` are both false, which is right for the quote path (a PDF quote
 *   is readable by a text-only document model). Every return label is an image,
 *   so a model with `fileInput: true, vision: false` would pass that gate and
 *   then be handed an `image` content block it cannot look at.
 *
 * All three fail **OPEN** for a model the registry has never heard of (BYO,
 * `supports: {}`), matching `resolveCapabilityGates` and the runtime's
 * `filterUnsupportedFeatures`: a `false` here is the registry stating outright
 * that the model cannot do this, not an absence of evidence.
 *
 * @param db Unused today. Taken anyway so the module presents one signature and
 *   no caller has to know which of these functions happens to touch the
 *   database — `transcribeLabel` does, and the router calls both.
 */
export async function checkReturnIntakeModelCapability(
  db: Database,
  organizationId: string
): Promise<Result<ReturnIntakeModelCapability, AuxxError>> {
  return guard(
    async () => {
      const { model } = await resolveModel(organizationId)
      const gates = resolveCapabilityGates(model, {
        structuredOutputEnabled: true,
        filesEnabled: true,
      })

      const capabilities = ProviderRegistry.getModelCapabilities(model)
      const displayName = capabilities?.displayName ?? model
      const blind = capabilities?.supports?.vision === false

      const warnings = [...gates.warnings]
      if (blind) {
        warnings.push(`${displayName} cannot read images.`)
      }

      const blocked = gates.skipFiles || gates.skipStructuredOutput || blind
      return {
        ok: !blocked,
        modelId: model,
        reason: blocked
          ? warnings.join(' ') ||
            `${displayName} cannot read a photo of a label. Pick another default model.`
          : null,
      }
    },
    'Failed to check the return-intake model capability',
    { organizationId }
  )
}

/**
 * What the provider will actually be handed, resolved from the stored asset.
 *
 * 🔑 The MIME type comes off the `MediaAsset` row rather than from the caller.
 * `ReturnIntakeLabel` carries `fileRef` and `fileName` and no MIME type, so a
 * caller-supplied one would be a guess made from a file extension — and `.heic`
 * is precisely the extension whose MIME type is worth not guessing (§3.3, §12
 * item 2).
 */
interface LabelImage {
  buffer: Buffer
  mimeType: string
  fileName: string
}

/**
 * Load the photographed label's bytes, org-scoped.
 *
 * Throws rather than returning a `Result`: the caller is already inside
 * {@link guard}, which converts an {@link AuxxError} into `err()` and anything
 * else into a logged `Internal error`.
 */
async function loadLabelImage(
  db: Database,
  organizationId: string,
  fileRef: string
): Promise<LabelImage> {
  const { sourceType, id: assetId } = parseFileRef(fileRef as never)
  if (sourceType !== 'asset' || !assetId) {
    throw new BadRequestError(`Not an uploaded asset: ${fileRef}`)
  }

  const ctx = { db, organizationId }
  const asset = await getAsset(ctx, assetId)
  if (asset.isErr()) throw asset.error
  if (!asset.value) {
    throw new BadRequestError(`Label photo ${fileRef} is not in this organization`)
  }

  const mimeType = asset.value.mimeType ?? ''
  if (!LLMClient.isSupportedFileMimeType(mimeType)) {
    throw new UnprocessableEntityError(
      `Cannot read a ${mimeType || 'file'} label. Upload a photo or a PDF.`
    )
  }

  const bytes = await getAssetContent(
    ctx,
    { storage: createS3StoragePort(organizationId) },
    assetId
  )
  if (bytes.isErr()) throw bytes.error

  return {
    buffer: bytes.value,
    mimeType,
    fileName: asset.value.name ?? 'label',
  }
}

/**
 * Pull the object out of the response.
 *
 * `structured_output` is `undefined` whenever the model returned something the
 * orchestrator could not parse, so the raw content is always the fallback —
 * including the fenced ```json a chat-tuned model wraps its answer in.
 *
 * Returns `null` rather than throwing when there is nothing parseable:
 * {@link parseTranscribedLabel} turns that into an illegible label, which is the
 * honest answer and the one the review screen can act on. A model that answered
 * "I can't read this" in prose has told us something true.
 */
function extractJson(structured: Record<string, unknown> | undefined, content: string): unknown {
  if (structured) return structured

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? content).trim()
  if (!candidate) return null
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

/**
 * Read one photographed return label into a {@link TranscribedLabel}.
 *
 * @param db Scope for the asset read. A pool or a caller's transaction.
 * @param organizationId The org the photo and the model configuration belong to.
 * @param userId The member whose upload this is, or `null` for a background run.
 *   Reaches credential resolution and the usage insert; never `''` — the usage
 *   column is a FK and `''` is a `User.id` that does not exist.
 * @param fileRef `asset:<mediaAssetId>` — the FileRef the temp upload produced.
 * @returns `err(UnprocessableEntityError)` when the model cannot see, or when the
 *   uploaded bytes are not something a model reads; `err(BadRequestError)` for a
 *   ref that is not this org's asset. An unreadable *photo* is not an error — it
 *   comes back `ok` with `legible: false`.
 */
export async function transcribeLabel(
  db: Database,
  organizationId: string,
  userId: string | null,
  fileRef: string
): Promise<Result<TranscribedLabel, AuxxError>> {
  return guard(
    async () => {
      const capability = await checkReturnIntakeModelCapability(db, organizationId)
      if (capability.isErr()) throw capability.error
      if (!capability.value.ok) {
        throw new UnprocessableEntityError(
          capability.value.reason ??
            `${capability.value.modelId} cannot read a photo of a label. Pick another default model.`
        )
      }

      const image = await loadLabelImage(db, organizationId, fileRef)

      // Text part FIRST — both provider clients read the instruction as the
      // frame for the block that follows it.
      const content: MultiModalContent[] = [
        { type: 'text', data: TRANSCRIBE_LABEL_PROMPT },
        LLMClient.fileToMultiModalContent(
          image.buffer.toString('base64'),
          image.mimeType,
          image.fileName,
          image.buffer.length
        ),
      ]

      const { provider, model } = await resolveModel(organizationId)
      const orchestrator = new LLMOrchestrator(new UsageTrackingService(db), db)
      const response = await orchestrator.invoke({
        model,
        provider,
        organizationId,
        userId,
        messages: [{ role: 'user', content }],
        context: { source: USAGE_SOURCE },
        structuredOutput: { enabled: true, schema: TRANSCRIBED_LABEL_JSON_SCHEMA },
      })

      const label = parseTranscribedLabel(
        extractJson(response.structured_output, response.content ?? '')
      )

      logger.info('Transcribed a return label', {
        organizationId,
        model,
        mimeType: image.mimeType,
        bytes: image.buffer.length,
        legible: label.legible,
        hasSender: label.senderName !== null,
        hasTracking: label.trackingNumber !== null,
      })

      return label
    },
    'Failed to transcribe a return label',
    { organizationId, fileRef }
  )
}

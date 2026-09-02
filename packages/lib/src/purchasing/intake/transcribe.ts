// packages/lib/src/purchasing/intake/transcribe.ts

/**
 * Step 1 of the intake pipeline (plans/money/tasks/38 §3): the vendor's document
 * in, the vendor's document as printed out.
 *
 * ONE `LLMOrchestrator.invoke`, no tools, the file as a content block, a JSON
 * schema on the way back. The reasons that shape is not negotiable:
 *
 * 🛑 **No tool loop.** Tools and structured output cannot share a call, so a
 * loop would force `document -> prose -> second model -> JSON`
 * (`run-structured-output-pass.ts`), and the second model never sees the
 * document. Every price and quantity would be transcribed twice, the second time
 * blind. §1.2.
 *
 * 🛑 **No `pdf-parse`.** A PDF goes to the model as bytes. `pdf-extractor.ts`
 * returns a flat text blob and discards layout, and a quote is a table where the
 * column a number sits in IS the meaning of the number. §0.
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
import { ModelType } from '../../ai/providers/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { getCachedDefaultModel } from '../../cache/org-cache-helpers'
import { ExtractorFactory } from '../../datasets/extractors/extractor-factory'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import { getAssetContent } from '../../files/assets/content'
import { createS3StoragePort } from '../../files/storage/ports'
import { resolveCapabilityGates } from '../../workflow-engine/nodes/utils/model-capability-gates'
import type { TranscribedQuote } from './client'
import { guard } from './guard'
import {
  parseTranscribedQuote,
  TRANSCRIBE_QUOTE_PROMPT,
  TRANSCRIBED_QUOTE_JSON_SCHEMA,
} from './schema'

const logger = createScopedLogger('purchasing:intake:transcribe')

/** Same fallback pair `import/fields/ai-auto-map-columns.ts` uses. */
const FALLBACK_PROVIDER = 'openai'
const FALLBACK_MODEL = 'gpt-5.4-nano'

/** What the capability gate decided, in the shape the dialog's first page renders. */
export interface IntakeModelCapability {
  ok: boolean
  modelId: string
  /** Why not, naming the model. `null` when `ok`. */
  reason: string | null
}

/** What `transcribeQuote` was pointed at. */
export interface TranscribeQuoteInput {
  /** `asset:<mediaAssetId>` — the FileRef the temp upload produced. */
  assetRef: string
  fileName?: string | null
  mimeType?: string | null
}

async function resolveModel(organizationId: string): Promise<{ provider: string; model: string }> {
  const configured = await getCachedDefaultModel(organizationId, ModelType.LLM)
  return {
    provider: configured?.provider ?? FALLBACK_PROVIDER,
    model: configured?.model ?? FALLBACK_MODEL,
  }
}

/**
 * Can this org's default model read a document at all?
 *
 * 🛑 Exposed as its own export because the dialog asks it **on open**, before a
 * file is picked (§6.2). Refusing after someone has chosen a document is the bad
 * version of the same refusal, and a model that cannot read a file must produce
 * a clear refusal naming the model rather than a silent empty draft.
 *
 * Both gates are fatal, not just the file one. `resolveCapabilityGates` fails
 * OPEN for unknown/BYO models (`supports: {}`), so a `false` here is the model
 * registry stating outright that it cannot do this — and a transcription that
 * cannot return JSON is not a degraded transcription, it is prose.
 */
export async function checkIntakeModelCapability(
  organizationId: string
): Promise<Result<IntakeModelCapability, Error>> {
  return guard(
    async () => {
      const { model } = await resolveModel(organizationId)
      const gates = resolveCapabilityGates(model, {
        structuredOutputEnabled: true,
        filesEnabled: true,
      })
      const blocked = gates.skipFiles || gates.skipStructuredOutput
      return {
        ok: !blocked,
        modelId: model,
        reason: blocked ? gates.warnings.join(' ') || `${model} cannot read documents` : null,
      }
    },
    'Failed to check the intake model capability',
    { organizationId }
  )
}

/** `.pdf` / `.xlsx` / `''` — what the extractor registry matches on. */
function extensionOf(fileName: string | null | undefined): string {
  if (!fileName) return ''
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

/** Spreadsheets become CSV; everything else the model cannot read becomes markdown. */
function convertedMimeType(extension: string, sourceMimeType: string): string {
  const spreadsheet =
    extension === '.xlsx' ||
    extension === '.xlsm' ||
    extension === '.xls' ||
    sourceMimeType.includes('spreadsheet') ||
    sourceMimeType === 'application/vnd.ms-excel'
  return spreadsheet ? 'text/csv' : 'text/markdown'
}

/** The bytes and the MIME type the provider will actually be handed. */
interface PreparedDocument {
  buffer: Buffer
  mimeType: string
  fileName: string
}

/**
 * Get the document into something `LLMClient.isSupportedFileMimeType` admits.
 *
 * 🛑 `isSupportedFileMimeType` REFUSES the OpenXML MIME types, so xlsx and docx
 * are converted **before** the gate rather than admitted through it (§3.2). PDFs
 * and images are already admitted and go as bytes — converting them is the
 * layout-destroying mistake §0 names.
 */
async function prepareDocument(
  organizationId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<PreparedDocument> {
  if (LLMClient.isSupportedFileMimeType(mimeType)) {
    return { buffer, mimeType, fileName }
  }

  const extension = extensionOf(fileName)
  let extracted: string
  try {
    const result = await ExtractorFactory.extractWithFallback(buffer, mimeType, extension, {
      fileName,
      organizationId,
    })
    extracted = result.content
  } catch (error) {
    logger.warn('Could not convert a quote into something the model reads', {
      error,
      mimeType,
      extension,
      organizationId,
    })
    throw new UnprocessableEntityError(
      `Cannot read a ${mimeType || extension || 'file'} quote. Upload it as a PDF, an image, a spreadsheet or a text file.`
    )
  }

  if (!extracted.trim()) {
    throw new UnprocessableEntityError('The uploaded document produced no readable content')
  }

  const converted = convertedMimeType(extension, mimeType)
  return {
    buffer: Buffer.from(extracted, 'utf8'),
    mimeType: converted,
    fileName: `${fileName || 'quote'}${converted === 'text/csv' ? '.csv' : '.md'}`,
  }
}

/**
 * Pull the object out of the response.
 *
 * `structured_output` is `undefined` whenever the model returned something the
 * orchestrator could not parse, so the raw content is always the fallback —
 * including the fenced ```json a chat-tuned model wraps its answer in.
 */
function extractJson(structured: Record<string, unknown> | undefined, content: string): unknown {
  if (structured) return structured

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = (fenced?.[1] ?? content).trim()
  if (!candidate) {
    throw new UnprocessableEntityError('The model returned nothing for this document')
  }
  try {
    return JSON.parse(candidate)
  } catch {
    throw new UnprocessableEntityError('The model did not return JSON for this document')
  }
}

/**
 * Read one vendor quote into {@link TranscribedQuote}.
 *
 * @param userId The member whose upload this is, or `null` for a background run.
 *   Reaches credential resolution and the usage insert; never `''`.
 */
export async function transcribeQuote(
  db: Database,
  organizationId: string,
  userId: string | null,
  input: TranscribeQuoteInput
): Promise<Result<TranscribedQuote, Error>> {
  return guard(
    async () => {
      const capability = await checkIntakeModelCapability(organizationId)
      if (capability.isErr()) throw capability.error
      if (!capability.value.ok) {
        throw new UnprocessableEntityError(
          capability.value.reason ??
            `${capability.value.modelId} cannot read documents. Pick another default model.`
        )
      }

      const { sourceType, id: assetId } = parseFileRef(input.assetRef as never)
      if (sourceType !== 'asset' || !assetId) {
        throw new BadRequestError(`Not an uploaded asset: ${input.assetRef}`)
      }

      const bytes = await getAssetContent(
        { db, organizationId },
        { storage: createS3StoragePort(organizationId) },
        assetId
      )
      if (bytes.isErr()) throw bytes.error

      const fileName = input.fileName ?? 'quote'
      const document = await prepareDocument(
        organizationId,
        bytes.value,
        input.mimeType ?? '',
        fileName
      )

      // Text part FIRST — both provider clients read the instruction as the
      // frame for the block that follows it.
      const content: MultiModalContent[] = [
        { type: 'text', data: TRANSCRIBE_QUOTE_PROMPT },
        LLMClient.fileToMultiModalContent(
          document.buffer.toString('base64'),
          document.mimeType,
          document.fileName,
          document.buffer.length
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
        context: { source: 'purchase_intake' },
        structuredOutput: { enabled: true, schema: TRANSCRIBED_QUOTE_JSON_SCHEMA },
      })

      const transcription = parseTranscribedQuote(
        extractJson(response.structured_output, response.content ?? '')
      )

      logger.info('Transcribed a vendor quote', {
        organizationId,
        model,
        lines: transcription.lines.length,
        mimeType: document.mimeType,
      })

      return transcription
    },
    'Failed to transcribe a vendor quote',
    { organizationId, assetRef: input.assetRef }
  )
}

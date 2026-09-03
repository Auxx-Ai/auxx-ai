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

/** What one read produced. */
export interface TranscribeQuoteOutput {
  quote: TranscribedQuote
  /**
   * The converted text the model actually read, or `null` for a PDF or an image
   * that went as bytes.
   *
   * The review screen has no way to render an `.xlsx` — its preview pane is an
   * `AttachmentPreview`, and there is no spreadsheet renderer — so this is the
   * only thing it can show beside the lines. It is also, deliberately, the exact
   * input the model saw: checking a transcription against something else is
   * checking the wrong document.
   */
  extractedText: string | null
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

/**
 * What the provider will actually be handed.
 *
 * 🛑 The two arms are not cosmetic. A `file` part on OpenAI accepts **PDF only**
 * — a converted spreadsheet handed over as `text/csv` comes back as
 * `400 Invalid file data: 'messages[0].content[1].file.file_data'`. Anthropic
 * accepts the same block because its client rewrites text MIME types into a
 * `document` with a text source, so the bug is invisible on half the providers.
 * Once we have converted a document to text ourselves, it IS text: send it as a
 * text part and let no provider guess.
 */
type PreparedDocument =
  /** Bytes the model reads natively — a PDF or an image. Layout survives. */
  | { kind: 'file'; buffer: Buffer; mimeType: string; fileName: string }
  /** Something we converted first. `text` is the exact content the model sees. */
  | { kind: 'text'; text: string; mimeType: string; fileName: string }

/**
 * Does the model read these bytes as a document, with the layout intact?
 *
 * PDFs and images only. `LLMClient.isSupportedFileMimeType` is a wider gate — it
 * admits all of `text/*` as a *file* — and using it here is what produced the
 * OpenAI 400: a CSV is legal to send, but not as a file part. Text goes as text.
 */
function isNativeDocumentMimeType(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/')
}

/** Bytes that are already text, so the extractor has nothing to do. */
function isAlreadyTextMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml'
  )
}

/**
 * Get the document into one of the two shapes a provider accepts.
 *
 * Three paths, and the split matters:
 *
 * - **PDF / image** — bytes, untouched. Converting them is the layout-destroying
 *   mistake §0 names: a quote is a table where the column a number sits in IS
 *   the meaning of the number, and only the model's own document reader sees it.
 * - **Already text** (`text/*`, JSON, XML) — decoded and sent as text. No
 *   extractor round trip, and no `file` part for a provider to reject.
 * - **Everything else** (xlsx, docx, …) — through `ExtractorFactory` (§3.2),
 *   then sent as text. `xlsx-extractor` renders every non-empty sheet as CSV
 *   under a `# <SheetName>` heading, which preserves the grid exactly; a
 *   spreadsheet loses nothing by not being an image.
 */
async function prepareDocument(
  organizationId: string,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<PreparedDocument> {
  if (isNativeDocumentMimeType(mimeType)) {
    return { kind: 'file', buffer, mimeType, fileName }
  }

  if (isAlreadyTextMimeType(mimeType)) {
    const text = buffer.toString('utf8')
    if (!text.trim()) {
      throw new UnprocessableEntityError('The uploaded document produced no readable content')
    }
    return { kind: 'text', text, mimeType, fileName: fileName || 'quote' }
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

  return {
    kind: 'text',
    text: extracted,
    mimeType: convertedMimeType(extension, mimeType),
    fileName: fileName || 'quote',
  }
}

/**
 * Name the source before the converted content.
 *
 * The model is about to read a CSV that was an `.xlsx` an instant ago. Saying so
 * is what stops it reporting sheet headings as line items, and the filename is
 * often where the vendor put the shipment or the quantity.
 */
function framePreparedText(document: { text: string; mimeType: string; fileName: string }): string {
  const shape = document.mimeType === 'text/csv' ? 'CSV' : 'text'
  return [
    `The vendor's quote, "${document.fileName}", converted to ${shape}.`,
    'A "# Name" heading starts a new sheet or section; it is not a line item.',
    '',
    document.text,
  ].join('\n')
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
): Promise<Result<TranscribeQuoteOutput, Error>> {
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
        document.kind === 'file'
          ? LLMClient.fileToMultiModalContent(
              document.buffer.toString('base64'),
              document.mimeType,
              document.fileName,
              document.buffer.length
            )
          : { type: 'text', data: framePreparedText(document) },
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

      const quote = parseTranscribedQuote(
        extractJson(response.structured_output, response.content ?? '')
      )

      logger.info('Transcribed a vendor quote', {
        organizationId,
        model,
        lines: quote.lines.length,
        sourceMimeType: input.mimeType ?? '',
        sentAs: document.kind,
        sentMimeType: document.mimeType,
        extractedChars: document.kind === 'text' ? document.text.length : null,
      })

      return {
        quote,
        extractedText: document.kind === 'text' ? document.text : null,
      }
    },
    'Failed to transcribe a vendor quote',
    { organizationId, assetRef: input.assetRef }
  )
}

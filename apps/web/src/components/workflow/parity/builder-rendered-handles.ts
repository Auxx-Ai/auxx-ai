// apps/web/src/components/workflow/parity/builder-rendered-handles.ts

import { NodeType } from '~/components/workflow/types/node-types'

/**
 * The handles each builder node's UI actually renders — the builder half of the
 * HANDLE contract, beside the engine half `engine-write-scrape.ts` extracts
 * (`outputHandles` per processor, plus `readEngineRoutedHandleLiterals` for the
 * core's own edge lookups).
 *
 * ── WHY A HAND-WRITTEN TABLE ────────────────────────────────────────────────
 * There is no central declaration of rendered handles anywhere in the builder —
 * that absence IS the finding this file records. Each node's `node.tsx` places
 * its own `<NodeSourceHandle handleId=…>` / `<NodeTargetHandle handleId=…>`
 * elements, the engine's `WorkflowGraphBuilder.getNodeHandles`
 * (`packages/lib/src/workflow-engine/core/workflow-graph-builder.ts:476`)
 * hard-codes its OWN per-type list, and nothing ever compares the two. That
 * blind spot hid a whole bug family: crud emits `outputHandle: 'fail'`, http
 * and six other processors emit `'error'`, the UI renders `fail` handles, and
 * the engine's Failed-path recovery looks for `sourceHandle === 'onError'` —
 * and none of them meet.
 *
 * This table is the INTERIM contract. The durable fix is a per-node handle
 * manifest in `packages/lib` that the graph builder, the processors and the
 * node components all consume — when that lands, this file is replaced by an
 * import and the parity test compares the engine against the manifest instead.
 * Until then: every entry below was verified against the cited render site, and
 * a node whose UI changes its handles MUST update its entry (the completeness
 * assertion in the test fails on a palette node with no entry).
 *
 * ── WHAT AN ENTRY MEANS ─────────────────────────────────────────────────────
 * `sources` / `targets` are the LITERAL handle ids the node's component passes
 * to `<NodeSourceHandle>` / `<NodeTargetHandle>` (or raw `<Handle>`), including
 * ones rendered conditionally (the eight types with a manifest `errorHandling`
 * declaration render `fail` only when `error_strategy === 'fail'`, via the
 * shared `nodes/shared/node-fail-branch.tsx`; the human node renders `timeout`
 * only when a timeout is configured) — a conditionally-rendered handle is still one the
 * builder can produce an edge for, which is what the parity question needs.
 * `dynamicSources` documents branch handles whose ids are USER DATA (if-else
 * case ids, text-classifier category ids); they cannot be enumerated here, and
 * the engine emits them via computed expressions the static reader records as
 * `dynamicOutputHandles` anyway, so neither side's dynamic half is asserted —
 * the prose keeps the shape written down.
 */
export interface RenderedHandles {
  /** Literal source-handle ids the node's UI renders. */
  sources: string[]
  /** Literal target-handle ids the node's UI renders. */
  targets: string[]
  /** Branch handles whose ids are user data — a description, not an id list. */
  dynamicSources?: string
}

export const BUILDER_RENDERED_HANDLES: Record<string, RenderedHandles> = {
  // nodes/core/ai/node.tsx (source), (fail — rendered when `hasFailBranch`,
  // i.e. error_strategy === 'fail'), (target). `ai` opted into failure policy
  // in plan 21 step 4.
  [NodeType.AI]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/answer/node.tsx:13 (source), :12 (target)
  [NodeType.ANSWER]: { sources: ['source'], targets: ['target'] },

  // nodes/core/chunker/node.tsx (source), (fail — rendered when
  // `hasFailBranch`), :41 (target)
  [NodeType.CHUNKER]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/code/node.tsx:20 (source), :14 (target)
  [NodeType.CODE]: { sources: ['source'], targets: ['target'] },

  // nodes/core/crud/node.tsx:63 (source), :83 (fail — rendered when
  // `hasFailBranch`, i.e. error_strategy === 'fail'), :48 (target)
  [NodeType.CRUD]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/dataset/node.tsx (source), (fail — rendered when
  // `hasFailBranch`), :38 (target)
  [NodeType.DATASET]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/date-time/node.tsx:53 (source), :42 (target)
  [NodeType.DATE_TIME]: { sources: ['source'], targets: ['target'] },

  // nodes/core/document-extractor/node.tsx (source), (fail — rendered when
  // `hasFailBranch`), :34 (target)
  [NodeType.DOCUMENT_EXTRACTOR]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/end/node.tsx:30 (source), :17 (target)
  [NodeType.END]: { sources: ['source'], targets: ['target'] },

  // nodes/core/find/node.tsx:108 (source), :58 (target)
  [NodeType.FIND]: { sources: ['source'], targets: ['target'] },

  // nodes/core/format/node.tsx:35 (source), :23 (target)
  [NodeType.FORMAT]: { sources: ['source'], targets: ['target'] },

  // nodes/inputs/form-input/node.tsx:23 — a single `input-output` source that
  // wires into another node's `input` handle; no target, no plain `source`.
  // (Its processor still emits 'source', which the assertion always accepts —
  // when wired into a trigger the node is NON_EXECUTABLE anyway, see
  // form-input-processor.ts:83.)
  [NodeType.FORM_INPUT]: { sources: ['input-output'], targets: [] },

  // nodes/core/http/node.tsx:32 (source), :50 (fail — rendered when
  // error_strategy === 'fail'), :21 (target)
  [NodeType.HTTP]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/human/node.tsx:89 (approved), :102 (denied), :122 (timeout —
  // rendered when a timeout is configured), :57 (target)
  [NodeType.HUMAN_CONFIRMATION]: {
    sources: ['approved', 'denied', 'timeout'],
    targets: ['target'],
  },

  // nodes/core/if-else/node.tsx:96 (one handle per case, id = case_id),
  // :128 (false — the ELSE arm), :78 (target)
  [NodeType.IF_ELSE]: {
    sources: ['false'],
    targets: ['target'],
    dynamicSources: 'one source handle per configured case, handleId = case_id (node.tsx:96)',
  },

  // nodes/core/information-extractor/node.tsx:67 (source), :25 (target)
  [NodeType.INFORMATION_EXTRACTOR]: { sources: ['source'], targets: ['target'] },

  // nodes/core/knowledge-retrieval/node.tsx (source), (fail — rendered when
  // `hasFailBranch`), :39 (target)
  [NodeType.KNOWLEDGE_RETRIEVAL]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/list/node.tsx (source), (fail — rendered when `hasFailBranch`),
  // :76 (target)
  [NodeType.LIST]: { sources: ['source', 'fail'], targets: ['target'] },

  // nodes/core/loop/node.tsx:36 (loop-start, into the loop body), :150 (source,
  // after the loop), :146 (target), :54 (loop-back — where the last node in the
  // body connects to close the iteration). Handle ids from LOOP_HANDLES
  // (nodes/core/loop/constants.ts:19).
  [NodeType.LOOP]: { sources: ['loop-start', 'source'], targets: ['target', 'loop-back'] },

  // nodes/core/manual/node.tsx:23 (source), :29 (input — the target that
  // form-input nodes wire their `input-output` into)
  [NodeType.MANUAL]: { sources: ['source'], targets: ['input'] },

  // nodes/core/message-received/node.tsx:15 (source; trigger, no target)
  [NodeType.MESSAGE_RECEIVED]: { sources: ['source'], targets: [] },

  // nodes/core/note/node.tsx:105 (target), :110 (source) — both invisible and
  // `isConnectable={false}`, rendered only to suppress React Flow warnings. A
  // note has no runtime, so nothing routes over them.
  [NodeType.NOTE]: { sources: ['source'], targets: ['target'] },

  // nodes/core/resource-trigger/node.tsx:28 (source; trigger, no target)
  [NodeType.RESOURCE_TRIGGER]: { sources: ['source'], targets: [] },

  // nodes/core/scheduled/node.tsx:32 (source; trigger, no target)
  [NodeType.SCHEDULED]: { sources: ['source'], targets: [] },

  // nodes/core/text-classifier/node.tsx:61 (source — variable mode only),
  // :79 (one handle per category, id = category.id — branches mode),
  // :93 (unmatched — branches mode), :30 (target)
  [NodeType.TEXT_CLASSIFIER]: {
    sources: ['source', 'unmatched'],
    targets: ['target'],
    dynamicSources:
      'branches mode renders one source handle per category, handleId = category.id (node.tsx:79)',
  },

  // nodes/core/var-assign/node.tsx:59 (source), :24 (target)
  [NodeType.VAR_ASSIGN]: { sources: ['source'], targets: ['target'] },

  // nodes/core/wait/node.tsx:125 (source), :76 (target)
  [NodeType.WAIT]: { sources: ['source'], targets: ['target'] },

  // nodes/core/webhook/node.tsx:17 (source; trigger, no target)
  [NodeType.WEBHOOK]: { sources: ['source'], targets: [] },

  // nodes/core/webhook-trigger/node.tsx:26 (source; trigger, no target)
  [NodeType.WEBHOOK_ENDPOINT]: { sources: ['source'], targets: [] },
}

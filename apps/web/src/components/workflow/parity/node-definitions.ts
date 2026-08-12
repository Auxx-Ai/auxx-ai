// apps/web/src/components/workflow/parity/node-definitions.ts

import type { NodeDefinition } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { BaseType } from '~/components/workflow/types/variable-types'
import { aiDefinition } from '../nodes/core/ai/schema'
import { answerDefinition } from '../nodes/core/answer/schema'
import { chunkerDefinition } from '../nodes/core/chunker/schema'
import { codeDefinition } from '../nodes/core/code/schema'
import { crudDefinition } from '../nodes/core/crud/schema'
import { datasetDefinition } from '../nodes/core/dataset/schema'
import { dateTimeNodeDefinition } from '../nodes/core/date-time/schema'
import { documentExtractorDefinition } from '../nodes/core/document-extractor/schema'
import { endDefinition } from '../nodes/core/end/schema'
import { findDefinition } from '../nodes/core/find/schema'
import { formatNodeDefinition } from '../nodes/core/format/schema'
import { httpNodeDefinition } from '../nodes/core/http/schema'
import { humanConfirmationDefinition } from '../nodes/core/human/schema'
import { ifElseDefinition } from '../nodes/core/if-else/schema'
import { informationExtractorDefinition } from '../nodes/core/information-extractor/schema'
import { knowledgeRetrievalDefinition } from '../nodes/core/knowledge-retrieval/schema'
import { listNodeDefinition } from '../nodes/core/list/schema'
import { loopDefinition } from '../nodes/core/loop/schema'
import { manualDefinition } from '../nodes/core/manual/schema'
import { messageReceivedDefinition } from '../nodes/core/message-received/schema'
import { noteDefinition } from '../nodes/core/note/schema'
import { resourceTriggerDefinition } from '../nodes/core/resource-trigger/schema'
import { scheduledTriggerDefinition } from '../nodes/core/scheduled/schema'
import { textClassifierDefinition } from '../nodes/core/text-classifier/schema'
import { varAssignDefinition } from '../nodes/core/var-assign/schema'
import { waitDefinition } from '../nodes/core/wait/schema'
import { webhookDefinition } from '../nodes/core/webhook/schema'
import { webhookTriggerDefinition } from '../nodes/core/webhook-trigger/schema'
import { formInputDefinition } from '../nodes/inputs/form-input/schema'

/**
 * Every node definition the builder registers, imported from its `schema.ts`
 * rather than from `nodes/core/registry.ts`.
 *
 * The registry module pulls in each node's React component and panel, which
 * drags most of the app's UI tree (and its providers) into the test process for
 * no benefit — the parity suite only ever reads `outputVariables`, `schema` and
 * `defaultData`. Importing the schema modules keeps the graph to zod plus the
 * node's own types.
 *
 * `note` carries no engine processor by design (it is a canvas annotation) and
 * is included so the suite notices if that ever changes.
 */
export const BUILDER_NODE_DEFINITIONS: Array<{
  nodeType: string
  definition: NodeDefinition
  /** Builder folder for this node, relative to `components/workflow/nodes/`. */
  dir: string
}> = [
  { nodeType: NodeType.AI, definition: aiDefinition as NodeDefinition, dir: 'core/ai' },
  { nodeType: NodeType.ANSWER, definition: answerDefinition as NodeDefinition, dir: 'core/answer' },
  {
    nodeType: NodeType.CHUNKER,
    definition: chunkerDefinition as NodeDefinition,
    dir: 'core/chunker',
  },
  { nodeType: NodeType.CODE, definition: codeDefinition as NodeDefinition, dir: 'core/code' },
  { nodeType: NodeType.CRUD, definition: crudDefinition as NodeDefinition, dir: 'core/crud' },
  {
    nodeType: NodeType.DATASET,
    definition: datasetDefinition as NodeDefinition,
    dir: 'core/dataset',
  },
  {
    nodeType: NodeType.DATE_TIME,
    definition: dateTimeNodeDefinition as NodeDefinition,
    dir: 'core/date-time',
  },
  {
    nodeType: NodeType.DOCUMENT_EXTRACTOR,
    definition: documentExtractorDefinition as NodeDefinition,
    dir: 'core/document-extractor',
  },
  { nodeType: NodeType.END, definition: endDefinition as NodeDefinition, dir: 'core/end' },
  { nodeType: NodeType.FIND, definition: findDefinition as NodeDefinition, dir: 'core/find' },
  {
    nodeType: NodeType.FORMAT,
    definition: formatNodeDefinition as NodeDefinition,
    dir: 'core/format',
  },
  {
    nodeType: NodeType.FORM_INPUT,
    definition: formInputDefinition as NodeDefinition,
    dir: 'inputs/form-input',
  },
  { nodeType: NodeType.HTTP, definition: httpNodeDefinition as NodeDefinition, dir: 'core/http' },
  {
    nodeType: NodeType.HUMAN_CONFIRMATION,
    definition: humanConfirmationDefinition as NodeDefinition,
    dir: 'core/human',
  },
  {
    nodeType: NodeType.IF_ELSE,
    definition: ifElseDefinition as NodeDefinition,
    dir: 'core/if-else',
  },
  {
    nodeType: NodeType.INFORMATION_EXTRACTOR,
    definition: informationExtractorDefinition as NodeDefinition,
    dir: 'core/information-extractor',
  },
  {
    nodeType: NodeType.KNOWLEDGE_RETRIEVAL,
    definition: knowledgeRetrievalDefinition as NodeDefinition,
    dir: 'core/knowledge-retrieval',
  },
  { nodeType: NodeType.LIST, definition: listNodeDefinition as NodeDefinition, dir: 'core/list' },
  { nodeType: NodeType.LOOP, definition: loopDefinition as NodeDefinition, dir: 'core/loop' },
  { nodeType: NodeType.MANUAL, definition: manualDefinition as NodeDefinition, dir: 'core/manual' },
  {
    nodeType: NodeType.MESSAGE_RECEIVED,
    definition: messageReceivedDefinition as NodeDefinition,
    dir: 'core/message-received',
  },
  { nodeType: NodeType.NOTE, definition: noteDefinition as NodeDefinition, dir: 'core/note' },
  {
    nodeType: NodeType.RESOURCE_TRIGGER,
    definition: resourceTriggerDefinition as NodeDefinition,
    dir: 'core/resource-trigger',
  },
  {
    nodeType: NodeType.SCHEDULED,
    definition: scheduledTriggerDefinition as NodeDefinition,
    dir: 'core/scheduled',
  },
  {
    nodeType: NodeType.TEXT_CLASSIFIER,
    definition: textClassifierDefinition as NodeDefinition,
    dir: 'core/text-classifier',
  },
  {
    nodeType: NodeType.VAR_ASSIGN,
    definition: varAssignDefinition as NodeDefinition,
    dir: 'core/var-assign',
  },
  { nodeType: NodeType.WAIT, definition: waitDefinition as NodeDefinition, dir: 'core/wait' },
  {
    nodeType: NodeType.WEBHOOK,
    definition: webhookDefinition as NodeDefinition,
    dir: 'core/webhook',
  },
  {
    nodeType: NodeType.WEBHOOK_ENDPOINT,
    definition: webhookTriggerDefinition as NodeDefinition,
    dir: 'core/webhook-trigger',
  },
]

/**
 * A minimal JSON schema for the three nodes that derive their advertised paths
 * from one (`ai.structured_output`, `information-extractor.structured_output`,
 * `webhook.bodySchema`). Two levels deep, so the nested-path walk in
 * `schemaToUnifiedVariable` is exercised and not just its top-level object.
 */
const OBJECT_SCHEMA = {
  type: 'object',
  properties: {
    field: { type: 'string' },
    nested: { type: 'object', properties: { inner: { type: 'string' } } },
    items: { type: 'array', items: { type: 'string' } },
  },
}

/**
 * Extra configurations to evaluate `outputVariables` under, beyond
 * `defaultData`.
 *
 * `outputVariables` is a FUNCTION of the node's config, so the advertised set is
 * config-dependent and the default config does not reach every branch. Each
 * entry names a branch that advertises a materially different set.
 *
 * A MISSING variant is not a gap in coverage, it is an assertion that silently
 * never runs — the advertised paths behind that flag are never compared against
 * anything. `manual.inputs` sat unasserted for the whole first pass of the
 * burn-down for exactly this reason, and it WAS real drift: the engine published
 * the payload under a global `manualInputs` key that had no readers at all.
 * So: when a node gates an advertisement on a config flag, it needs a variant
 * here that turns the flag on.
 *
 * Not exhaustive, and deliberately so: `crud`/`find` in resource mode need a
 * populated `Resource` (fields, relationships, entity-definition id) that only
 * exists against a live org, so those branches are out of reach here and their
 * variables are not asserted. `thread` mode needs no resource, which is why it
 * is the one that can be pinned.
 */
export const CONFIG_VARIANTS: Record<
  string,
  Array<{ label: string; data: Record<string, unknown> }>
> = {
  // `toolsEnabled` gates the whole `tool_results` subtree (`ai/schema.ts:389`),
  // and it defaults to `false`, so nothing else reaches it.
  [NodeType.AI]: [
    { label: 'tools enabled', data: { toolsEnabled: true } },
    {
      label: 'structured output',
      data: { structured_output: { enabled: true, schema: OBJECT_SCHEMA } },
    },
  ],

  [NodeType.CRUD]: [
    { label: 'thread mode', data: { resourceType: 'thread', mode: 'update' } },
    {
      label: 'thread mode, default error strategy',
      data: { resourceType: 'thread', mode: 'update', error_strategy: 'default' },
    },
  ],

  // The URL arm advertises `metadata.sourceUrl` / `metadata.contentLength`, which
  // the default FILE arm does not (`document-extractor/output-variables.ts:31`).
  [NodeType.DOCUMENT_EXTRACTOR]: [{ label: 'url source', data: { sourceType: 'url' } }],

  // Only `split` advertises an ARRAY `result` with a `result[*]` item; the
  // default `combine` advertises a bare STRING (`format/output-variables.ts:17`).
  [NodeType.FORMAT]: [{ label: 'split operation', data: { operation: 'split' } }],

  // `form-input/output-variables.ts:21` switches on `inputType` and the default
  // (`string`) hits the `default:` case, so five whole shapes — address, single
  // file, multi file, tags/array, currency — are otherwise never advertised.
  [NodeType.FORM_INPUT]: [
    { label: 'address input', data: { inputType: BaseType.ADDRESS } },
    { label: 'currency input', data: { inputType: BaseType.CURRENCY } },
    { label: 'tags input', data: { inputType: BaseType.TAGS } },
    { label: 'array input', data: { inputType: BaseType.ARRAY } },
    { label: 'single file input', data: { inputType: BaseType.FILE } },
    {
      label: 'multi file input',
      data: { inputType: BaseType.FILE, typeOptions: { file: { allowMultiple: true } } },
    },
  ],

  // `extracted_data` and everything under it exists only with a schema
  // (`information-extractor/schema.ts:253`); the default ships `enabled: false`.
  [NodeType.INFORMATION_EXTRACTOR]: [
    {
      label: 'structured output',
      data: { structured_output: { enabled: true, schema: OBJECT_SCHEMA } },
    },
  ],

  // `accumulateResults` defaults to true, which advertises `results`/`lastResult`;
  // the false arm advertises `result` instead (`loop/schema.ts:153`).
  [NodeType.LOOP]: [{ label: 'without accumulation', data: { accumulateResults: false } }],

  // `inputs` is advertised only when a form-input node is wired into the trigger
  // (`manual/schema.ts`, `if (data.inputNodes?.length)`), and `defaultData` seeds
  // `inputNodes: []`. The id is never dereferenced by `outputVariables`, so any
  // non-empty array reaches the branch.
  [NodeType.MANUAL]: [{ label: 'with connected inputs', data: { inputNodes: ['form-input-1'] } }],

  // `cron_expression` replaces `interval_config` on the custom-cron arm
  // (`scheduled/schema.ts:222`); the default interval is `hours`.
  [NodeType.SCHEDULED]: [
    {
      label: 'custom cron',
      data: { config: { triggerInterval: 'custom', cronExpression: '0 * * * *' } },
    },
  ],

  // The default seeds ONE assignment with an empty `name`, and `outputVariables`
  // filters those out — so by default this node advertises nothing at all and the
  // assertion never runs. Both arms need a named assignment to be reached.
  [NodeType.VAR_ASSIGN]: [
    {
      label: 'named scalar variable',
      data: { variables: [{ id: 'v1', name: 'myVar', type: BaseType.STRING, value: '' }] },
    },
    {
      label: 'named array variable',
      data: {
        variables: [{ id: 'v1', name: 'myList', type: BaseType.STRING, value: '', isArray: true }],
      },
    },
  ],

  // A declared body schema replaces the generic OBJECT `body` with the schema's
  // own nested paths (`webhook/schema.ts:106`).
  [NodeType.WEBHOOK]: [
    {
      label: 'declared body schema',
      data: { bodySchema: { enabled: true, schema: OBJECT_SCHEMA } },
    },
  ],
}

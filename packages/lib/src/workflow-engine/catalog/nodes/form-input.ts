// packages/lib/src/workflow-engine/catalog/nodes/form-input.ts

import { z } from 'zod'
import { FILE_TYPE_CATEGORIES, type FileTypeCategory } from '../../../files/file-type-constants'
import { BaseType } from '../../core/types'
import type { UnifiedVariable } from '../../types/unified-variable'
import { type BaseNodeData, baseNodeDataSchema } from '../node-base'
import { VAR_TYPE_ICON_MAP } from '../type-icons'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { createNestedVariable, createUnifiedOutputVariable } from '../variable-conversion'

/**
 * The form-input node's catalog manifest.
 *
 * Unlike every other migrated type, this node is **not a link in the chain**.
 * It never executes (`NON_EXECUTABLE_NODE_TYPES`, `core/types.ts`) — it declares
 * ONE field on the manual trigger's run form, and attaches to that trigger with
 * a backwards edge on two non-standard handles
 * (`form-input --input-output--> manual --input`). `NodeCategory.INPUT` here is
 * load-bearing: it is the source half of that wiring rule, read by
 * `graph-edit/validate.ts` (`isInputNodePair`) and by the
 * canvas's `use-node-validation.ts`. The target half is `manual`'s
 * `connection.acceptsInputNodes`.
 *
 * The data half (type-option shapes, zod schema, defaults, validator, output
 * resolver) lives here as the single source; apps/web
 * `nodes/inputs/form-input/schema.ts` merges it with the React parts via
 * `defineFromManifest`, and `output-variables.ts` re-exports
 * {@link getFormInputOutputVariables} so the builder picker and the server
 * resolver cannot drift.
 *
 * Engine note: `nodes/form-input/form-input-processor.ts` and
 * `validation/form-input-validator.ts` both used to re-declare these option
 * shapes. They now `Pick` from {@link FormInputNodeData} instead. The
 * validator's own `FormInputConfig` stays — it is a flattened, `nodeId`-carrying
 * extract of a persisted graph, not node data.
 */

/**
 * Select option for ENUM type
 */
export interface EnumOption {
  label: string
  value: string
}

/**
 * File options for FILE type
 */
export interface FileTypeOptions {
  allowMultiple: boolean
  maxFiles?: number
  maxFileSize?: number // in MB
  /** @deprecated Use allowedFileTypes and allowedFileExtensions instead */
  allowedTypes?: string[]
  /** Allowed file type categories: image, document, video, audio, custom */
  allowedFileTypes?: FileTypeCategory[]
  /** Custom file extensions when allowedFileTypes includes 'custom' */
  allowedFileExtensions?: string[]
}

/**
 * Currency options for CURRENCY type (flat — matches CurrencyFieldOptions).
 *
 * Only `currencyCode` is required: the engine processor reads it alone
 * (`setCurrencyOutputs`) and treated the rest as optional all along, so the
 * looser shape is the one that describes real data.
 */
export interface CurrencyTypeOptions {
  currencyCode: string
  decimals?: number
  currencyDisplay?: 'symbol' | 'code' | 'name' | 'compact'
  useGrouping?: boolean
}

/**
 * Address options for ADDRESS type
 */
export interface AddressTypeOptions {
  components: string[] // ['street1', 'street2', 'city', 'state', 'zipCode', 'country']
}

/**
 * Boolean options for BOOLEAN type
 */
export interface BooleanTypeOptions {
  variant?: 'switch' | 'button-group'
  /** Label shown next to the switch */
  label?: string
}

/**
 * String options for STRING type
 */
export interface StringTypeOptions {
  /** Use textarea for multiline input */
  multiline?: boolean
  /** Minimum character length */
  minLength?: number
  /** Maximum character length */
  maxLength?: number
}

/**
 * Type-specific options union
 */
export interface TypeOptions {
  enum?: EnumOption[]
  file?: FileTypeOptions
  currency?: CurrencyTypeOptions
  address?: AddressTypeOptions
  boolean?: BooleanTypeOptions
  string?: StringTypeOptions
}

/**
 * Form input node data interface.
 * Uses `BaseType` for type selection (aligned with the FieldType→BaseType
 * migration).
 */
export interface FormInputNodeData extends BaseNodeData {
  desc?: string

  // Core field properties
  /** The field label shown on the run form. Required — see the validator. */
  label: string
  /** The input type (defaults to STRING for backward compat) */
  inputType: BaseType
  placeholder?: string
  required?: boolean
  defaultValue?: string | number | boolean | null
  /** Helper text shown to end users when filling the input field */
  hint?: string

  // Type-specific options
  typeOptions?: TypeOptions

  /**
   * Fractional index (`generateKeyBetween`) ordering this field within the run
   * form — NOT a canvas coordinate. Written by the manual trigger panel's
   * connected-inputs editor when fields are dragged.
   */
  position?: string
}

const enumOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
})

/**
 * Zod schema for the type-specific options.
 *
 * Widened to the TS interface during the migration: `string`, `boolean.label`,
 * `file.allowedFileTypes` / `allowedFileExtensions` were all written by the
 * panel (and `allowedFileTypes` is READ by the engine's
 * `validation/form-input-validator.ts`) while the schema described none of
 * them. Harmless while nothing parsed — but the manifest schema is what
 * `describe_node_type` projects to Kopilot, so a key missing here is a key
 * Kopilot can never author.
 */
const typeOptionsSchema = z
  .object({
    enum: z.array(enumOptionSchema).optional(),
    file: z
      .object({
        allowMultiple: z.boolean(),
        maxFiles: z.number().optional(),
        maxFileSize: z.number().optional(),
        allowedTypes: z.array(z.string()).optional(),
        allowedFileTypes: z.array(z.enum(FILE_TYPE_CATEGORIES)).optional(),
        allowedFileExtensions: z.array(z.string()).optional(),
      })
      .optional(),
    currency: z
      .object({
        currencyCode: z.string(),
        decimals: z.number().int().min(0).max(10).optional(),
        currencyDisplay: z.enum(['symbol', 'code', 'name', 'compact']).optional(),
        useGrouping: z.boolean().optional(),
      })
      .optional(),
    address: z
      .object({
        components: z.array(z.string()),
      })
      .optional(),
    boolean: z
      .object({
        variant: z.enum(['switch', 'button-group']).optional(),
        label: z.string().optional(),
      })
      .optional(),
    string: z
      .object({
        multiline: z.boolean().optional(),
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
      })
      .optional(),
  })
  .optional()

/**
 * Zod schema for form-input node data.
 *
 * `label` is deliberately NOT `.min(1)` here: the catalog coverage test parses
 * `defaultData()` against this schema and a fresh node legitimately has an empty
 * label. Required-ness lives in {@link validateFormInputData}, with the same
 * field, message and severity.
 */
export const formInputNodeDataSchema = baseNodeDataSchema.extend({
  label: z.string(),
  inputType: z.enum(BaseType).default(BaseType.STRING),
  placeholder: z.string().optional(),
  required: z.boolean().default(false),
  defaultValue: z.any().optional(),
  hint: z.string().max(500, 'Hint must be 500 characters or less').optional(),
  typeOptions: typeOptionsSchema,
  position: z.string().optional(),
})

/**
 * Create default data for a form-input node
 */
export const createFormInputDefaultData = (): Partial<FormInputNodeData> => ({
  title: 'Form Input',
  desc: 'Collect input from user',
  label: '',
  inputType: BaseType.STRING,
  placeholder: '',
  required: false,
})

/**
 * Validate form-input node data.
 *
 * Carries the required-`label` check the schema deliberately omits, plus the
 * ENUM warning (an option-less select renders an unusable field but must not
 * block publishing — the engine processor warns identically).
 */
export function validateFormInputData(data: FormInputNodeData): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.label?.trim()) {
    errors.push({ field: 'label', message: 'Label is required', type: 'error' })
  }

  // Type-specific validation
  const inputType = data.inputType || BaseType.STRING

  if (inputType === BaseType.ENUM) {
    if (!data.typeOptions?.enum?.length) {
      errors.push({
        field: 'typeOptions.enum',
        message: 'At least one option is required',
        type: 'warning',
      })
    }
  }

  return {
    isValid: errors.filter((e) => e.type === 'error').length === 0,
    errors,
  }
}

/**
 * Output variables for a form-input node, by `inputType`.
 *
 * Mirrors what the engine writes for this node's id — which is the MANUAL
 * trigger's job, not this node's: `ManualTriggerProcessor` publishes the
 * contract through `applyFormInputOutputVariables` because a wired form-input
 * never executes. Pure: it reads only its own config, never the
 * `OutputContext`.
 */
export function getFormInputOutputVariables(
  data: FormInputNodeData,
  nodeId: string
): UnifiedVariable[] {
  const variables: UnifiedVariable[] = []
  const inputType = data.inputType || BaseType.STRING

  switch (inputType) {
    case BaseType.ADDRESS:
      variables.push(
        createNestedVariable({
          nodeId,
          basePath: 'value',
          type: BaseType.ADDRESS,
          label: 'Value',
          description: `Address value for "${data.label}"`,
          properties: {
            street1: { type: BaseType.STRING, description: 'Street address' },
            street2: { type: BaseType.STRING, description: 'Apartment/Suite' },
            city: { type: BaseType.STRING, description: 'City' },
            state: { type: BaseType.STRING, description: 'State/Province' },
            zipCode: { type: BaseType.STRING, description: 'ZIP/Postal Code' },
            country: { type: BaseType.STRING, description: 'Country' },
          },
        })
      )
      break

    case BaseType.FILE:
      if (data.typeOptions?.file?.allowMultiple) {
        variables.push(
          createNestedVariable({
            nodeId,
            basePath: 'files',
            type: BaseType.ARRAY,
            label: 'Files',
            description: `Uploaded files for "${data.label}"`,
            items: {
              type: BaseType.FILE,
              label: 'File',
              description: 'Individual file',
              properties: {
                id: { type: BaseType.STRING, description: 'File ID' },
                filename: { type: BaseType.STRING, description: 'Filename' },
                size: { type: BaseType.NUMBER, description: 'Size in bytes' },
                mimeType: { type: BaseType.STRING, description: 'MIME type' },
                url: { type: BaseType.URL, description: 'Download URL' },
              },
            },
          })
        )
        variables.push(
          createNestedVariable({
            nodeId,
            basePath: 'fileCount',
            type: BaseType.NUMBER,
            label: 'File Count',
            description: 'Number of uploaded files',
          })
        )
      } else {
        variables.push(
          createNestedVariable({
            nodeId,
            basePath: 'file',
            type: BaseType.FILE,
            label: 'File',
            description: `Uploaded file for "${data.label}"`,
            properties: {
              id: { type: BaseType.STRING, description: 'File ID' },
              filename: { type: BaseType.STRING, description: 'Filename' },
              size: { type: BaseType.NUMBER, description: 'Size in bytes' },
              mimeType: { type: BaseType.STRING, description: 'MIME type' },
              url: { type: BaseType.URL, description: 'Download URL' },
            },
          })
        )
      }
      break

    case BaseType.TAGS:
    case BaseType.ARRAY:
      variables.push(
        createUnifiedOutputVariable({
          nodeId,
          path: 'values',
          type: BaseType.ARRAY,
          label: 'Values',
          description: `Values for "${data.label}"`,
        })
      )
      variables.push(
        createUnifiedOutputVariable({
          nodeId,
          path: 'count',
          type: BaseType.NUMBER,
          label: 'Count',
          description: 'Number of values',
        })
      )
      break

    case BaseType.CURRENCY:
      variables.push(
        createNestedVariable({
          nodeId,
          basePath: 'value',
          type: BaseType.CURRENCY,
          label: 'Value',
          description: `Currency value for "${data.label}"`,
          properties: {
            amount: { type: BaseType.NUMBER, description: 'Numeric amount' },
            currency: { type: BaseType.STRING, description: 'Currency code' },
            formatted: { type: BaseType.STRING, description: 'Formatted string' },
          },
        })
      )
      break

    default:
      // STRING, NUMBER, BOOLEAN, EMAIL, URL, PHONE, DATE, DATETIME, TIME, ENUM
      variables.push(
        createUnifiedOutputVariable({
          nodeId,
          path: 'value',
          type: inputType,
          label: 'Value',
          description: `Input value for "${data.label}"`,
        })
      )
  }

  // Common variables for all types
  variables.push(
    createUnifiedOutputVariable({
      nodeId,
      path: 'label',
      type: BaseType.STRING,
      label: 'Label',
      description: 'The label of this input field',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'inputType',
      type: BaseType.STRING,
      label: 'Input Type',
      description: 'The type of this input field',
    }),
    createUnifiedOutputVariable({
      nodeId,
      path: 'isEmpty',
      type: BaseType.BOOLEAN,
      label: 'Is Empty',
      description: 'Whether the input is empty/null',
    })
  )

  return variables
}

/**
 * Form Input node manifest.
 */
export const formInputManifest: NodeManifest<FormInputNodeData> = {
  id: 'form-input',
  // Load-bearing: the source half of the input-wiring rule. See the file
  // docblock — changing this silently breaks form-input → manual wiring.
  category: NodeCategory.INPUT,
  displayName: 'Form Input',
  description: 'Collect input from user (text, number, date, file, etc.)',
  icon: 'text-cursor-input',
  getIcon: (data: FormInputNodeData) => {
    const inputType = data.inputType || BaseType.STRING
    return VAR_TYPE_ICON_MAP[inputType] || 'text-cursor-input'
  },
  color: '#22C55E',
  defaultData: createFormInputDefaultData,
  configSchema: formInputNodeDataSchema as unknown as z.ZodType<FormInputNodeData>,
  validate: validateFormInputData,
  resolveOutputs: getFormInputOutputVariables,
  connection: {
    // It never executes, so there is nothing to run in isolation.
    canRunSingle: false,
    // No `branches`: the node renders ONE source handle (`input-output`), and
    // validate.ts's input-wiring exception depends on the declared handle set
    // staying the default `['source']`.
  },
  agent: {
    authorable: true,
    usage:
      'Declares ONE field on a manual trigger’s run form. This node never runs on its own — ' +
      'it only has an effect once it is attached to a `manual` trigger, so add it with ' +
      'add_node({ type: "form-input", inputFor: "<trigger title>" }), which creates the field ' +
      'and wires it onto that trigger’s run form in ONE call (the edge runs backwards, into ' +
      'the trigger). Use connect_nodes FROM the form-input node TO the trigger only to attach a ' +
      'form-input that already exists and is not wired up. A form-input node that is not ' +
      'attached to a trigger does nothing. ' +
      '`label` is what the person filling the form sees and is required. `inputType` is one of ' +
      'string, number, boolean, email, url, phone, date, datetime, time, enum, file, currency, ' +
      'address, tags, array — it decides both the form control and the variables the node ' +
      'advertises downstream (`value` for simple types; `value.street1`… for address; ' +
      '`file` or `files`/`fileCount` for file; `values`/`count` for tags and array; plus ' +
      '`label`, `inputType` and `isEmpty` for every type). Type-specific settings go under ' +
      '`typeOptions.<type>`: `enum` needs a non-empty option list, `file` takes ' +
      '`allowMultiple` / `maxFiles` / `allowedFileTypes`, `string` takes ' +
      '`multiline` / `minLength` / `maxLength`.',
    examples: [
      {
        description: 'A required single-line text field (add it with inputFor: the trigger title)',
        config: {
          title: 'Ticket Subject',
          label: 'Subject',
          inputType: 'string',
          placeholder: 'Short summary',
          required: true,
        },
      },
      {
        description: 'A multi-line text field',
        config: {
          title: 'Ticket Body',
          label: 'Description',
          inputType: 'string',
          required: true,
          typeOptions: { string: { multiline: true, maxLength: 2000 } },
        },
      },
      {
        description: 'A file upload accepting several documents',
        config: {
          title: 'Attachments',
          label: 'Attachments',
          inputType: 'file',
          typeOptions: {
            file: { allowMultiple: true, maxFiles: 5, allowedFileTypes: ['document', 'image'] },
          },
        },
      },
    ],
  },
}

// apps/web/src/components/workflow/nodes/inputs/form-input/output-variables.ts

import type { UnifiedVariable } from '~/components/workflow/types/variable-types'
import { BaseType } from '~/components/workflow/types/unified-types'
import {
  createUnifiedOutputVariable,
  createNestedVariable,
} from '~/components/workflow/utils/variable-conversion'
import type { FormInputNodeData } from './types'

/**
 * Generate output variables for form-input node based on inputType
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
              description: 'Individual file',
              properties: {
                id: { type: BaseType.STRING, description: 'File ID' },
                filename: { type: BaseType.STRING, description: 'Filename' },
                size: { type: BaseType.NUMBER, description: 'Size in bytes' },
                mimeType: { type: BaseType.STRING, description: 'MIME type' },
                url: { type: BaseType.URL, description: 'Download URL' },
              },
            },
            properties: {
              count: { type: BaseType.NUMBER, description: 'Number of files' },
              totalSize: { type: BaseType.NUMBER, description: 'Total size' },
            },
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

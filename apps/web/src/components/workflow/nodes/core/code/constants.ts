// apps/web/src/components/workflow/nodes/core/code/constants.ts

import { BaseType } from '~/components/workflow/types/unified-types'

/**
 * Type option for the output type selector
 */
export interface TypeOption {
  value: string
  label: string
  baseType: BaseType
  itemType?: BaseType
}

/**
 * Available type options for code node outputs
 * @deprecated Use VariableTypePicker with isArray toggle instead
 * Will be removed in next major version
 */
export const OUTPUT_TYPE_OPTIONS: TypeOption[] = [
  // Primitive types
  { value: BaseType.STRING, label: 'String', baseType: BaseType.STRING },
  { value: BaseType.NUMBER, label: 'Number', baseType: BaseType.NUMBER },
  { value: BaseType.BOOLEAN, label: 'Boolean', baseType: BaseType.BOOLEAN },
  { value: BaseType.OBJECT, label: 'Object', baseType: BaseType.OBJECT },
  { value: BaseType.DATE, label: 'Date', baseType: BaseType.DATE },
  { value: BaseType.DATETIME, label: 'Date & Time', baseType: BaseType.DATETIME },
  { value: BaseType.FILE, label: 'File', baseType: BaseType.FILE },
  { value: BaseType.JSON, label: 'JSON', baseType: BaseType.JSON },
  { value: BaseType.ANY, label: 'Any', baseType: BaseType.ANY },

  // Array types
  {
    value: `array(${BaseType.STRING})`,
    label: 'Array (String)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.STRING,
  },
  {
    value: `array(${BaseType.NUMBER})`,
    label: 'Array (Number)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.NUMBER,
  },
  {
    value: `array(${BaseType.BOOLEAN})`,
    label: 'Array (Boolean)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.BOOLEAN,
  },
  {
    value: `array(${BaseType.OBJECT})`,
    label: 'Array (Object)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.OBJECT,
  },
  {
    value: `array(${BaseType.DATE})`,
    label: 'Array (Date)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.DATE,
  },
  {
    value: `array(${BaseType.FILE})`,
    label: 'Array (File)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.FILE,
  },
  {
    value: `array(${BaseType.ANY})`,
    label: 'Array (Any)',
    baseType: BaseType.ARRAY,
    itemType: BaseType.ANY,
  },
]

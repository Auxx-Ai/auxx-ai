// apps/web/src/components/workflow/ui/structured-output-generator/schema-to-vars.ts
import { ArrayType, type Field, type SchemaRoot, Type } from './types'

export interface OutputVariable {
  name: string
  type: string
  description?: string
  subItems?: OutputVariable[]
}

function getVarType(field: Field): string {
  switch (field.type) {
    case Type.string:
      return field.enum ? `String Enum` : 'String'
    case Type.number:
      return field.enum ? `Number Enum` : 'Number'
    case Type.boolean:
      return 'Boolean'
    case Type.object:
      return 'Object'
    case Type.array:
      if (field.items) {
        switch (field.items.type) {
          case Type.string:
            return 'String[]'
          case Type.number:
            return 'Number[]'
          case Type.boolean:
            return 'Boolean[]'
          case Type.object:
            return 'Object[]'
          default:
            return 'Array'
        }
      }
      return 'Array'
    default:
      return 'Any'
  }
}

function processField(name: string, field: Field): OutputVariable {
  const variable: OutputVariable = {
    name,
    type: getVarType(field),
    description: field.description,
  }

  // Handle object properties
  if (field.type === Type.object && field.properties) {
    variable.subItems = Object.entries(field.properties).map(([propName, propField]) =>
      processField(propName, propField)
    )
  }

  // Handle array of objects
  if (field.type === Type.array && field.items?.type === Type.object && field.items.properties) {
    variable.subItems = Object.entries(field.items.properties).map(([propName, propField]) =>
      processField(propName, propField)
    )
  }

  return variable
}

export function schemaToOutputVars(schema: SchemaRoot | undefined): OutputVariable[] {
  if (!schema || !schema.properties) {
    return []
  }

  return Object.entries(schema.properties).map(([name, field]) => processField(name, field))
}

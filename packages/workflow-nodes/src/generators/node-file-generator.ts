// packages/workflow-nodes/src/generators/node-file-generator.ts

import type {
  UnifiedNodeConfig,
  FieldConfig,
  SectionConfig,
  ValidationRule,
} from '../types/unified-config'

/**
 * Generates TypeScript and React files from unified node configuration
 */
export class NodeFileGenerator {
  constructor(private config: UnifiedNodeConfig) {}

  /**
   * Generate TypeScript types file
   */
  generateTypes(): string {
    const nodeData = this.generateNodeDataInterface()
    const panelProps = this.generatePanelPropsInterface()

    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

import type { BaseNodeData, NodeType } from '~/components/workflow/types'

${nodeData}

${panelProps}
`
  }

  /**
   * Generate React components file
   */
  generateComponents(): string {
    const imports = this.generateImports()
    const panelComponent = this.generatePanelComponent()

    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

'use client'

${imports}

${panelComponent}
`
  }

  /**
   * Generate Zod schema file
   */
  generateSchema(): string {
    const schema = this.generateZodSchema()
    const validator = this.generateValidator()

    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

import { z } from 'zod'
import type { ${this.getNodeDataTypeName()} } from './types'

${schema}

${validator}
`
  }

  /**
   * Generate node definition file
   */
  generateDefinition(): string {
    const definition = this.generateNodeDefinition()

    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

import { NodeDefinition, NodeCategory } from '~/components/workflow/types'
import { NodeType } from '~/components/workflow/types/node-types'
import { ${this.getPanelComponentName()} } from './components'
import { validate${this.capitalize(this.config.node.id)}Node, ${this.config.node.id}NodeSchema } from './schema'
import type { ${this.getNodeDataTypeName()} } from './types'

${definition}
`
  }

  /**
   * Generate visual node component for React Flow
   */
  generateNodeComponent(): string {
    const nodeComponentName = this.getNodeComponentName()
    const nodePropsTypeName = this.getNodePropsTypeName()

    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

'use client'

import { memo } from 'react'
import { BaseNode } from '~/components/workflow/nodes/shared/base/base-node'
import { NodeSourceHandle, NodeTargetHandle } from '~/components/workflow/ui/node-handle'
import type { ${nodePropsTypeName} } from './types'

export const ${nodeComponentName} = memo<${nodePropsTypeName}>(({ id, data, selected }) => {
  return (
    <BaseNode id={id} data={data} selected={selected} width={${this.config.visual?.width || 260}} height="${this.config.visual?.height || 'auto'}">
      <NodeTargetHandle id={id} data={{ ...data, selected }} handleId="target" />
      
      <div className="space-y-2 pb-2">
        {/* Node Header */}
        <div className="relative px-2">
          <div className="flex items-center justify-between rounded-md bg-primary-100 p-2">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">${this.config.node.displayName}</span>
            </div>
          </div>
        </div>
        
        ${this.generatePreviewContent()}
      </div>
      
      <NodeSourceHandle handleId="source" id={id} data={{ ...data, selected }} />
    </BaseNode>
  )
})

${nodeComponentName}.displayName = '${nodeComponentName}'`
  }

  /**
   * Generate preview content based on visual config
   */
  private generatePreviewContent(): string {
    const visual = this.config.visual
    if (!visual?.preview) return ''

    const parts = []

    if (visual.preview.contentField) {
      parts.push(`        {/* Content Preview */}
        {data.${visual.preview.contentField} && (
          <div className="relative px-2">
            <div className="rounded-md bg-gray-50 p-2">
              <p className="text-xs text-gray-600 line-clamp-2">
                {data.${visual.preview.contentField}}
              </p>
            </div>
          </div>
        )}`)
    }

    if (visual.preview.actionField) {
      parts.push(`        {/* Action Badge */}
        <div className="relative px-2">
          <div className="flex items-center justify-between text-xs">
            <span className="capitalize text-gray-500">
              {data.${visual.preview.actionField}}
            </span>
          </div>
        </div>`)
    }

    return parts.join('\n\n')
  }

  /**
   * Generate index file
   */
  generateIndex(): string {
    return `// 🤖 AUTO-GENERATED from ${this.config.node.id}.config.json - DO NOT EDIT

export { ${this.getPanelComponentName()} } from './components'
export { ${this.getNodeComponentName()} } from './node'
export type { ${this.getNodeDataTypeName()}, ${this.getPanelPropsTypeName()}, ${this.getNodePropsTypeName()} } from './types'
export { validate${this.capitalize(this.config.node.id)}Node, ${this.config.node.id}NodeSchema } from './schema'
export { ${this.config.node.id}Definition } from './definition'
`
  }

  /**
   * Generate NodeData interface
   */
  private generateNodeDataInterface(): string {
    const typeName = this.getNodeDataTypeName()
    const fields = this.getAllFields()

    const properties = fields
      .map((field) => {
        const type = this.getFieldTypeScript(field)
        const optional = field.required ? '' : '?'
        return `  ${field.name}${optional}: ${type}`
      })
      .join('\n')

    return `export interface ${typeName} extends BaseNodeData {
  type: NodeType.${this.getNodeTypeKey()}
${properties}
}`
  }

  /**
   * Generate PanelProps interface
   */
  private generatePanelPropsInterface(): string {
    const panelPropsTypeName = this.getPanelPropsTypeName()
    const nodePropsTypeName = this.getNodePropsTypeName()
    const nodeDataType = this.getNodeDataTypeName()

    return `export interface ${panelPropsTypeName} {
  nodeId: string
  data: ${nodeDataType}
}

export interface ${nodePropsTypeName} {
  id: string
  data: ${nodeDataType}
  selected: boolean
}`
  }

  /**
   * Generate imports for components file
   */
  private generateImports(): string {
    const standardImports = [
      "import { useCallback } from 'react'",
      "import { produce } from 'immer'",
      "import { BasePanel } from '~/components/workflow/nodes/shared/base/base-panel'",
      "import { useNodeCrud, useReadOnly } from '~/components/workflow/hooks'",
      "import Field from '~/components/workflow/ui/field'",
      "import Section from '~/components/workflow/ui/section'",
    ]

    // Add UI component imports based on field types
    const uiImports = new Set<string>()
    const fields = this.getAllFields()

    fields.forEach((field) => {
      switch (field.type) {
        case 'input':
        case 'number':
        case 'email':
        case 'url':
        case 'password':
          uiImports.add("import { Input } from '@auxx/ui/components/input'")
          break
        case 'textarea':
          uiImports.add("import { Textarea } from '@auxx/ui/components/textarea'")
          break
        case 'select':
          uiImports.add(
            "import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@auxx/ui/components/select'"
          )
          break
        case 'checkbox':
          uiImports.add("import { Checkbox } from '@auxx/ui/components/checkbox'")
          break
      }
    })

    // Add type imports
    const typeImports = [
      `import type { ${this.getNodeDataTypeName()}, ${this.getPanelPropsTypeName()} } from './types'`,
    ]

    return [...standardImports, ...Array.from(uiImports), ...typeImports].join('\n')
  }

  /**
   * Generate panel React component
   */
  private generatePanelComponent(): string {
    const componentName = this.getPanelComponentName()
    const nodeDataType = this.getNodeDataTypeName()
    const propsType = this.getPanelPropsTypeName()

    const sections = this.config.ui.sections
      .map((section) => this.generateSectionComponent(section))
      .join('\n\n')

    return `export const ${componentName} = ({ nodeId, data }: ${propsType}) => {
  const { isReadOnly } = useReadOnly()
  const { inputs, setInputs } = useNodeCrud<${nodeDataType}>(nodeId, data)

  const updateField = useCallback(
    (field: keyof ${nodeDataType}, value: any) => {
      const newInputs = produce(inputs, (draft) => {
        ;(draft as any)[field] = value
      })
      setInputs(newInputs)
    },
    [inputs, setInputs]
  )

  return (
    <BasePanel nodeId={nodeId} data={data}>
${sections}
    </BasePanel>
  )
}`
  }

  /**
   * Generate section component
   */
  private generateSectionComponent(section: SectionConfig): string {
    const fields = section.children.map((field) => this.generateFieldComponent(field)).join('\n\n')

    const showWhen = section.showWhen ? ` showWhen={${JSON.stringify(section.showWhen)}}` : ''

    return `      {/* ${section.title} Section */}
      <Section title="${section.title}"${showWhen}>
${fields}
      </Section>`
  }

  /**
   * Generate field component based on type
   */
  private generateFieldComponent(field: FieldConfig): string {
    const fieldComponent = this.generateFieldInput(field)
    const required = field.required ? ' required' : ''
    const showWhen = field.showWhen
      ? `{/* TODO: Implement conditional logic for ${field.id} */}\n        `
      : ''

    return `        ${showWhen}<Field title="${field.title}"${required}>
          ${fieldComponent}
        </Field>`
  }

  /**
   * Generate input component based on field type
   */
  private generateFieldInput(field: FieldConfig): string {
    const value = `inputs?.${field.name} || ${this.getDefaultValue(field)}`
    const onChange = `(${this.getOnChangeParam(field)}) => updateField('${field.name}', ${this.getOnChangeValue(field)})`
    const disabled = 'disabled={isReadOnly}'

    switch (field.type) {
      case 'input':
      case 'email':
      case 'url':
      case 'password':
        return `<Input
            value={${value}}
            onChange={(e) => updateField('${field.name}', e.target.value)}
            placeholder="${field.placeholder || ''}"
            type="${field.type === 'input' ? 'text' : field.type}"
            ${disabled}
          />`

      case 'number':
        return `<Input
            type="number"
            value={${value}}
            onChange={(e) => updateField('${field.name}', Number(e.target.value))}
            placeholder="${field.placeholder || ''}"
            ${field.min !== undefined ? `min={${field.min}}` : ''}
            ${field.max !== undefined ? `max={${field.max}}` : ''}
            ${disabled}
          />`

      case 'textarea':
        return `<Textarea
            value={${value}}
            onChange={(e) => updateField('${field.name}', e.target.value)}
            placeholder="${field.placeholder || ''}"
            ${field.rows ? `rows={${field.rows}}` : ''}
            ${disabled}
          />`

      case 'select':
        return `<Select
            value={${value}}
            onValueChange={(value) => updateField('${field.name}', value)}
            ${disabled}>
            <SelectTrigger>
              <SelectValue placeholder="${field.placeholder || 'Select option'}" />
            </SelectTrigger>
            <SelectContent>
              ${field.options
                ?.map(
                  (option) =>
                    `<SelectItem key="${option.value}" value="${option.value}">
                  <div>
                    <div className="font-medium">${option.name}</div>
                    ${option.description ? `<div className="text-sm text-gray-500">${option.description}</div>` : ''}
                  </div>
                </SelectItem>`
                )
                .join('\n              ')}
            </SelectContent>
          </Select>`

      case 'checkbox':
        return `<Checkbox
            checked={${value}}
            onCheckedChange={(checked) => updateField('${field.name}', checked)}
            ${disabled}
          />`

      case 'datetime':
        return `<Input
            type="datetime-local"
            value={${value}}
            onChange={(e) => updateField('${field.name}', e.target.value)}
            ${disabled}
          />`

      default:
        return `{/* TODO: Implement ${field.type} field type */}
          <div>Field type "${field.type}" not implemented</div>`
    }
  }

  /**
   * Generate Zod schema
   */
  private generateZodSchema(): string {
    const fields = this.getAllFields()
    const schemaFields = fields
      .map((field) => {
        const zodType = this.getZodType(field)
        return `  ${field.name}: ${zodType},`
      })
      .join('\n')

    const schemaName = `${this.config.node.id}NodeSchema`

    return `export const ${schemaName} = z.object({
${schemaFields}
})`
  }

  /**
   * Generate validator function
   */
  private generateValidator(): string {
    const functionName = `validate${this.capitalize(this.config.node.id)}Node`
    const schemaName = `${this.config.node.id}NodeSchema`
    const nodeDataType = this.getNodeDataTypeName()

    return `export function ${functionName}(data: Partial<${nodeDataType}>) {
  return ${schemaName}.safeParse(data)
}`
  }

  /**
   * Generate node definition
   */
  private generateNodeDefinition(): string {
    const definitionName = `${this.config.node.id}Definition`
    const nodeDataType = this.getNodeDataTypeName()
    const panelComponent = this.getPanelComponentName()
    const validator = `validate${this.capitalize(this.config.node.id)}Node`
    const schema = `${this.config.node.id}NodeSchema`

    const defaultValues = this.generateDefaultValues()

    return `export const ${definitionName}: NodeDefinition<${nodeDataType}> = {
  id: NodeType.${this.getNodeTypeKey()},
  category: NodeCategory.${this.config.node.category.toUpperCase()},
  displayName: '${this.config.node.displayName}',
  description: '${this.config.node.description}',
  icon: '${this.config.node.icon.replace('.svg', '')}',
  color: '${this.config.node.color || '#6366f1'}',
  defaultData: ${defaultValues},
  schema: ${schema},
  panel: ${panelComponent},
  validator: (data: ${nodeDataType}) => {
    const result = ${validator}(data)
    return {
      isValid: result.success,
      errors: result.success ? [] : result.error.issues.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        type: 'error' as const
      }))
    }
  },
  canRunSingle: ${this.config.execution?.canRunSingle || true},
}`
  }

  /**
   * Helper methods
   */
  private getAllFields(): FieldConfig[] {
    return this.config.ui.sections.flatMap((section) => section.children)
  }

  private getNodeDataTypeName(): string {
    return `${this.capitalize(this.config.node.id)}NodeData`
  }

  private getPanelComponentName(): string {
    return `${this.capitalize(this.config.node.id)}Panel`
  }

  private getPanelPropsTypeName(): string {
    return `${this.capitalize(this.config.node.id)}PanelProps`
  }

  private getNodeComponentName(): string {
    return `${this.capitalize(this.config.node.id)}Node`
  }

  private getNodePropsTypeName(): string {
    return `${this.capitalize(this.config.node.id)}NodeProps`
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  private getNodeTypeKey(): string {
    // Handle specific mappings
    const mappings: Record<string, string> = {
      professionalNetwork: 'PROFESSIONAL_NETWORK',
      linkedin: 'PROFESSIONAL_NETWORK',
      testNode: 'TESTNODE',
      // Add more mappings as needed
    }

    return mappings[this.config.node.id] || this.config.node.id.toUpperCase()
  }

  private getFieldTypeScript(field: FieldConfig): string {
    switch (field.type) {
      case 'input':
      case 'textarea':
      case 'email':
      case 'url':
      case 'password':
      case 'datetime':
        return 'string'
      case 'number':
        return 'number'
      case 'checkbox':
        return 'boolean'
      case 'select':
        return field.options?.map((o) => `'${o.value}'`).join(' | ') || 'string'
      default:
        return 'string'
    }
  }

  private getZodType(field: FieldConfig): string {
    let zodType = ''

    switch (field.type) {
      case 'input':
      case 'textarea':
      case 'email':
      case 'url':
      case 'password':
      case 'datetime':
        zodType = 'z.string()'
        break
      case 'number':
        zodType = 'z.number()'
        break
      case 'checkbox':
        zodType = 'z.boolean()'
        break
      case 'select':
        if (field.options) {
          const values = field.options.map((o) => `'${o.value}'`).join(', ')
          zodType = `z.enum([${values}])`
        } else {
          zodType = 'z.string()'
        }
        break
      default:
        zodType = 'z.string()'
    }

    // Add validation rules
    if (field.validation) {
      field.validation.forEach((rule) => {
        switch (rule.type) {
          case 'required':
            if (!field.required) zodType += `.min(1, '${rule.message}')`
            break
          case 'minLength':
            zodType += `.min(${rule.value}, '${rule.message}')`
            break
          case 'maxLength':
            zodType += `.max(${rule.value}, '${rule.message}')`
            break
          case 'email':
            zodType += `.email('${rule.message}')`
            break
          case 'url':
            zodType += `.url('${rule.message}')`
            break
        }
      })
    }

    // Handle optional fields
    if (!field.required) {
      zodType += '.optional()'
    }

    return zodType
  }

  private getDefaultValue(field: FieldConfig): string {
    if (field.default !== undefined) {
      return typeof field.default === 'string' ? `'${field.default}'` : String(field.default)
    }

    switch (field.type) {
      case 'checkbox':
        return 'false'
      case 'number':
        return '0'
      default:
        return "''"
    }
  }

  private generateDefaultValues(): string {
    const fields = this.getAllFields()
    const defaults = fields
      .map((field) => {
        const value = this.getDefaultValue(field)
        return `  ${field.name}: ${value}`
      })
      .join(',\n')

    return `{\n${defaults}\n}`
  }

  private getOnChangeParam(field: FieldConfig): string {
    switch (field.type) {
      case 'select':
        return 'value'
      case 'checkbox':
        return 'checked'
      default:
        return 'e'
    }
  }

  private getOnChangeValue(field: FieldConfig): string {
    switch (field.type) {
      case 'select':
        return 'value'
      case 'checkbox':
        return 'checked'
      case 'number':
        return 'Number(e.target.value)'
      default:
        return 'e.target.value'
    }
  }
}

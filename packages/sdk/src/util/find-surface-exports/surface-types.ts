/**
 * Converts a surface type name to PascalCase by capitalizing the first letter.
 *
 * @param name - The surface type name to convert (e.g., 'recordAction')
 * @returns The PascalCase version of the name (e.g., 'RecordAction')
 *
 * @example
 * ```typescript
 * getSurfaceTypeName('recordAction') // Returns 'RecordAction'
 * getSurfaceTypeName('workflowBlock') // Returns 'WorkflowBlock'
 * ```
 */
export function getSurfaceTypeName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * TypeScript interface definition for a record action surface type.
 * Defines the structure for actions that can be performed on individual records.
 */
const recordActionTypeDefinition = `
export interface ${getSurfaceTypeName('recordAction')} {
    id: string
    label: string
    icon: string
    onTrigger: (record: {recordId: string; object: string}) => void | Promise<void>
    objects?: ObjectSlug | Array<ObjectSlug> | ((attributes: Array<Attribute>) => boolean)
}
`

/**
 * TypeScript interface definition for a bulk record action surface type.
 * Defines the structure for actions that can be performed on multiple records simultaneously.
 */
const bulkRecordActionTypeDefinition = `
export interface ${getSurfaceTypeName('bulkRecordAction')} {
    id: string
    label: string
    icon: string
    onTrigger: (record: {recordIds: Array<string>; object: string}) => void | Promise<void>
    objects?: ObjectSlug | Array<ObjectSlug> | ((attributes: Array<Attribute>) => boolean)
}
`

/**
 * TypeScript interface definition for a record widget surface type.
 * Defines the structure for custom UI widgets that can be displayed for records.
 */
const recordWidgetTypeDefinition = `
export interface ${getSurfaceTypeName('recordWidget')} {
    id: string
    Widget: (props: {recordId: string; object: ObjectSlug}) => React.JSX.Element
    objects?: ObjectSlug | Array<ObjectSlug> | ((attributes: Array<Attribute>) => boolean)
}
`

/**
 * TypeScript interface definition for a call recording insight text selection action.
 * Defines the structure for actions that can be performed on selected text within call recording insights.
 */
const callRecordingInsightTextSelectionActionTypeDefinition = `
export interface ${getSurfaceTypeName('callRecordingInsightTextSelectionAction')} {
    id: string
    label: string
    icon: string
    onTrigger: (selection: {text: string; markdown: string}) => void | Promise<void>
}
`

/**
 * TypeScript interface definition for a call recording summary text selection action.
 * Defines the structure for actions that can be performed on selected text within call recording summaries.
 */
const callRecordingSummaryTextSelectionActionTypeDefinition = `
export interface ${getSurfaceTypeName('callRecordingSummaryTextSelectionAction')} {
    id: string
    label: string
    icon: string
    onTrigger: (selection: {text: string; markdown: string}) => void | Promise<void>
}
`

/**
 * TypeScript interface definition for a call recording transcript text selection action.
 * Defines the structure for actions that can be performed on selected transcript segments from call recordings.
 */
const callRecordingTranscriptTextSelectionActionTypeDefinition = `
export interface ${getSurfaceTypeName('callRecordingTranscriptTextSelectionAction')} {
    id: string
    label: string
    icon: string
    onTrigger: (selection: {transcript: Array<{speaker: string; text: string}>; url: string}) => void | Promise<void>
}
`

/**
 * TypeScript interface definition for a workflow block surface type.
 * Defines the structure for custom blocks that can be used in workflow definitions.
 */
const workflowBlockTypeDefinition = `
export interface ${getSurfaceTypeName('workflowBlock')} {
    id: string
    title: string
    configSchema: Record<string, Node> | Struct
    configurator: React.ReactNode
}
`

/**
 * TypeScript interface definition for organization settings surface type.
 * Defines the structure for custom settings pages within the organization.
 */
const organizationSettingsTypeDefinition = `
export interface ${getSurfaceTypeName('organizationSettings')} {
    id: string
    Page: React.ComponentType<{}>
}
`

/**
 * Combined TypeScript interface definitions for all surface types.
 *
 * This string contains all surface type interfaces concatenated together, which can be
 * used to create an in-memory TypeScript source file for type checking during surface
 * export discovery and validation.
 *
 * Includes definitions for:
 * - RecordAction
 * - BulkRecordAction
 * - RecordWidget
 * - CallRecordingInsightTextSelectionAction
 * - CallRecordingSummaryTextSelectionAction
 * - CallRecordingTranscriptTextSelectionAction
 * - OrganizationSettings
 * - WorkflowBlock
 */
export const surfaceTypeDefinitions = `
${recordActionTypeDefinition}

${bulkRecordActionTypeDefinition}

${recordWidgetTypeDefinition}

${callRecordingInsightTextSelectionActionTypeDefinition}

${callRecordingSummaryTextSelectionActionTypeDefinition}

${callRecordingTranscriptTextSelectionActionTypeDefinition}

${organizationSettingsTypeDefinition}

${workflowBlockTypeDefinition}
`

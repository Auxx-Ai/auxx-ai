// apps/web/src/components/workflow/nodes/core/ai/tool-credential-registry.ts

export interface ToolCredentialRequirement {
  toolId: string
  toolType: 'workflow_node' | 'built_in'
  nodeType?: string // For workflow nodes
  requiredCredentialTypes: string[]
  isCredentialRequired: boolean
  description?: string
}

/**
 * Registry of credential requirements for different tools
 */
export const TOOL_CREDENTIAL_REQUIREMENTS: ToolCredentialRequirement[] = [
  // Workflow Node Tools
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'http',
    requiredCredentialTypes: [
      'httpBasicAuth',
      'httpHeaderAuth',
      'oAuth2Api',
      'googleOAuth2Api',
      'outlookOAuth2Api',
    ],
    isCredentialRequired: false,
    description: 'HTTP requests may require authentication',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'crud',
    requiredCredentialTypes: [
      'postgres',
      'postgresWithTesting',
      'crateDb',
      'httpBasicAuth',
      'httpHeaderAuth',
    ],
    isCredentialRequired: true,
    description: 'Database operations require connection credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'find',
    requiredCredentialTypes: ['postgres', 'postgresWithTesting', 'crateDb'],
    isCredentialRequired: true,
    description: 'Database search operations require connection credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'text-classifier',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Text classification does not require credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'information-extractor',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Information extraction does not require credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'var-assign',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Variable assignment does not require credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'code',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Code execution does not require credentials',
  },
  {
    toolId: 'workflow_node',
    toolType: 'workflow_node',
    nodeType: 'date-time',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Date/time operations do not require credentials',
  },

  // Built-in Tools
  {
    toolId: 'http_request',
    toolType: 'built_in',
    requiredCredentialTypes: [
      'httpBasicAuth',
      'httpHeaderAuth',
      'oAuth2Api',
      'googleOAuth2Api',
      'outlookOAuth2Api',
    ],
    isCredentialRequired: false,
    description: 'HTTP requests may require authentication',
  },
  {
    toolId: 'assign_variable',
    toolType: 'built_in',
    requiredCredentialTypes: [],
    isCredentialRequired: false,
    description: 'Variable assignment does not require credentials',
  },
]

/**
 * Get credential requirement for a specific tool
 */
export function getToolCredentialRequirement(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string
): ToolCredentialRequirement | undefined {
  return TOOL_CREDENTIAL_REQUIREMENTS.find((req) => {
    if (req.toolType !== toolType) return false

    if (toolType === 'workflow_node') {
      return req.nodeType === nodeType
    } else {
      return req.toolId === toolId
    }
  })
}

/**
 * Check if a tool requires credentials
 */
export function isToolCredentialRequired(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string
): boolean {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)
  return requirement?.isCredentialRequired || false
}

/**
 * Get allowed credential types for a tool
 */
export function getToolAllowedCredentialTypes(
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string
): string[] {
  const requirement = getToolCredentialRequirement(toolId, toolType, nodeType)
  return requirement?.requiredCredentialTypes || []
}

/**
 * Check if a credential type is compatible with a tool
 */
export function isCredentialTypeCompatibleWithTool(
  credentialType: string,
  toolId: string,
  toolType: 'workflow_node' | 'built_in',
  nodeType?: string
): boolean {
  const allowedTypes = getToolAllowedCredentialTypes(toolId, toolType, nodeType)
  return allowedTypes.includes(credentialType)
}

/**
 * Get tools that require credentials
 */
export function getToolsRequiringCredentials(): ToolCredentialRequirement[] {
  return TOOL_CREDENTIAL_REQUIREMENTS.filter((req) => req.isCredentialRequired)
}

/**
 * Get tools by credential type compatibility
 */
export function getToolsByCredentialType(credentialType: string): ToolCredentialRequirement[] {
  return TOOL_CREDENTIAL_REQUIREMENTS.filter((req) =>
    req.requiredCredentialTypes.includes(credentialType)
  )
}

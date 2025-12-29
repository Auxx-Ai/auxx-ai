// packages/lib/src/workflow-engine/core/tool-registry.ts

import { createScopedLogger } from '@auxx/logger'
import type { NodeProcessorRegistry } from './node-processor-registry'
import { WorkflowNodeType, type Workflow } from './types'

const logger = createScopedLogger('tool-registry')

/**
 * JSON Schema interface for tool input/output definitions
 */
export interface JSONSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array'
  properties?: Record<string, JSONSchema>
  items?: JSONSchema
  required?: string[]
  description?: string
  enum?: any[]
  additionalProperties?: boolean
}

/**
 * Tool definition interface
 */
export interface ToolDefinition {
  id: string // Unique tool identifier
  name: string // Function name for AI (must be valid identifier)
  description: string // What the tool does
  nodeType: WorkflowNodeType // Source node type
  nodeConfig: Record<string, any> // Pre-configured node settings
  inputSchema: JSONSchema // Input parameters schema
  outputSchema: JSONSchema // Expected output structure
  category?: string // Tool grouping (e.g., 'data', 'communication')
  enabled: boolean // Tool availability toggle
  sourceNodeId?: string // If tool is based on existing workflow node
}

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean
  output: Record<string, any>
  error?: string
  executionTime?: number
  metadata?: Record<string, any>
}

/**
 * Registry for managing workflow tools
 * Generates tools dynamically from workflow nodes and built-in definitions
 */
export class ToolRegistry {
  private nodeRegistry: NodeProcessorRegistry
  private builtInTools: Map<string, ToolDefinition> = new Map()

  constructor(nodeRegistry: NodeProcessorRegistry) {
    this.nodeRegistry = nodeRegistry
    this.initializeBuiltInTools()
  }

  /**
   * Generate available tools for an AI node based on:
   * 1. Other nodes in the same workflow
   * 2. Built-in node types that can be used as tools
   */
  getAvailableToolsForWorkflow(
    workflow: Workflow,
    currentNodeId: string,
    toolsConfig?: {
      mode?: 'workflow_nodes' | 'built_in' | 'both'
      allowedNodeIds?: string[]
      allowedBuiltInTools?: string[]
    }
  ): ToolDefinition[] {
    const tools: ToolDefinition[] = []
    const mode = toolsConfig?.mode || 'both'

    // Add workflow node tools
    if (mode === 'workflow_nodes' || mode === 'both') {
      if (workflow.graph?.nodes) {
        const otherNodes = workflow.graph.nodes.filter((node: any) => node.id !== currentNodeId)

        for (const node of otherNodes) {
          // Check if this specific node is allowed
          if (toolsConfig?.allowedNodeIds && !toolsConfig.allowedNodeIds.includes(node.id)) {
            continue
          }

          const tool = this.convertNodeToTool(node)
          if (tool) {
            tools.push(tool)
          }
        }
      }
    }

    // Add built-in tools
    if (mode === 'built_in' || mode === 'both') {
      for (const [toolId, tool] of this.builtInTools) {
        // Check if this specific built-in tool is allowed
        if (toolsConfig?.allowedBuiltInTools && !toolsConfig.allowedBuiltInTools.includes(toolId)) {
          continue
        }

        tools.push(tool)
      }
    }

    logger.debug('Generated tools for workflow', {
      workflowId: workflow.workflowId,
      nodeId: currentNodeId,
      toolCount: tools.length,
      mode,
    })

    return tools
  }

  /**
   * Get a specific tool by ID
   */
  getTool(toolId: string, workflow?: Workflow): ToolDefinition | undefined {
    // First check built-in tools
    const builtInTool = this.builtInTools.get(toolId)
    if (builtInTool) {
      return builtInTool
    }

    // Then check workflow node tools
    if (workflow?.graph?.nodes && toolId.startsWith('node_')) {
      const nodeId = toolId.replace('node_', '')
      const node = workflow.graph.nodes.find((n: any) => n.id === nodeId)
      if (node) {
        return this.convertNodeToTool(node)
      }
    }

    return undefined
  }

  /**
   * Get all built-in tools
   */
  getBuiltInTools(): ToolDefinition[] {
    return Array.from(this.builtInTools.values())
  }

  /**
   * Generate tools schema for AI providers (OpenAI/Anthropic format)
   */
  generateToolsSchema(tools: ToolDefinition[], format: 'openai' | 'anthropic' = 'openai'): any[] {
    if (format === 'openai') {
      return tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }))
    } else if (format === 'anthropic') {
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }))
    }

    return []
  }

  /**
   * Convert a workflow graph node to a tool definition
   */
  private convertNodeToTool(node: any): ToolDefinition | null {
    const nodeType = node.type as WorkflowNodeType

    // Only convert nodes that make sense as tools
    switch (nodeType) {
      case WorkflowNodeType.HTTP:
        return this.createHttpNodeTool(node)
      case WorkflowNodeType.CRUD:
        return this.createCrudNodeTool(node)
      case WorkflowNodeType.FIND:
        return this.createFindNodeTool(node)
      case WorkflowNodeType.TEXT_CLASSIFIER:
        return this.createTextClassifierNodeTool(node)
      case WorkflowNodeType.INFORMATION_EXTRACTOR:
        return this.createInformationExtractorNodeTool(node)
      case WorkflowNodeType.VAR_ASSIGN:
        return this.createVarAssignNodeTool(node)
      case WorkflowNodeType.CODE:
        return this.createCodeNodeTool(node)
      case WorkflowNodeType.DATE_TIME:
        return this.createDateTimeNodeTool(node)
      default:
        return null
    }
  }

  /**
   * Create HTTP node tool
   */
  private createHttpNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `HTTP Request ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'HTTP request'}`,
      nodeType: WorkflowNodeType.HTTP,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'communication',
      inputSchema: {
        type: 'object',
        properties: {
          // Allow override of configured values if needed
          ...(node.data?.url ? {} : { url: { type: 'string', description: 'URL to request' } }),
          ...(node.data?.method
            ? {}
            : {
                method: {
                  type: 'string',
                  enum: ['GET', 'POST', 'PUT', 'DELETE'],
                  description: 'HTTP method',
                },
              }),
          headers: { type: 'object', description: 'Additional headers' },
          body: { type: 'object', description: 'Request body' },
          params: { type: 'object', description: 'Query parameters' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Response data' },
          status: { type: 'number', description: 'HTTP status code' },
          headers: { type: 'object', description: 'Response headers' },
        },
      },
    }
  }

  /**
   * Create CRUD node tool
   */
  private createCrudNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Database Operation ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Database operation'}`,
      nodeType: WorkflowNodeType.CRUD,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'data',
      inputSchema: {
        type: 'object',
        properties: {
          filters: { type: 'object', description: 'Query filters' },
          data: { type: 'object', description: 'Data for create/update operations' },
          options: { type: 'object', description: 'Additional options' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'object', description: 'Operation result' },
          affected: { type: 'number', description: 'Number of affected records' },
        },
      },
    }
  }

  /**
   * Create Find node tool
   */
  private createFindNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Find ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Find records'}`,
      nodeType: WorkflowNodeType.FIND,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'data',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          filters: { type: 'object', description: 'Search filters' },
          limit: { type: 'number', description: 'Maximum results' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          results: { type: 'array', description: 'Found records' },
          count: { type: 'number', description: 'Total count' },
        },
      },
    }
  }

  /**
   * Create Text Classifier node tool
   */
  private createTextClassifierNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Text Classifier ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Classify text'}`,
      nodeType: WorkflowNodeType.TEXT_CLASSIFIER,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'transform',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to classify' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          classification: { type: 'string', description: 'Classification result' },
          confidence: { type: 'number', description: 'Confidence score' },
        },
      },
    }
  }

  /**
   * Create Information Extractor node tool
   */
  private createInformationExtractorNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Information Extractor ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Extract information'}`,
      nodeType: WorkflowNodeType.INFORMATION_EXTRACTOR,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'transform',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to extract from' },
          fields: { type: 'array', description: 'Fields to extract' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          extracted: { type: 'object', description: 'Extracted information' },
        },
      },
    }
  }

  /**
   * Create Variable Assignment node tool
   */
  private createVarAssignNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Variable Assignment ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Assign variables'}`,
      nodeType: WorkflowNodeType.VAR_ASSIGN,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'data',
      inputSchema: {
        type: 'object',
        properties: {
          variables: { type: 'object', description: 'Variables to assign' },
        },
        required: ['variables'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          assigned: { type: 'object', description: 'Assigned variables' },
        },
      },
    }
  }

  /**
   * Create Code node tool
   */
  private createCodeNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Code Execution ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Execute code'}`,
      nodeType: WorkflowNodeType.CODE,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'transform',
      inputSchema: {
        type: 'object',
        properties: {
          inputs: { type: 'object', description: 'Input variables for code' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'object', description: 'Code execution result' },
        },
      },
    }
  }

  /**
   * Create Date Time node tool
   */
  private createDateTimeNodeTool(node: any): ToolDefinition {
    const title = node.data?.title || `Date Time ${node.id}`
    const functionName = this.sanitizeFunctionName(`call_${title}`)

    return {
      id: `node_${node.id}`,
      name: functionName,
      description: `Execute ${title} - ${node.data?.desc || 'Date/time operations'}`,
      nodeType: WorkflowNodeType.DATE_TIME,
      nodeConfig: node.data || {},
      sourceNodeId: node.id,
      enabled: true,
      category: 'transform',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Input date' },
          operation: { type: 'string', description: 'Date operation' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          result: { type: 'string', description: 'Formatted date/time result' },
        },
      },
    }
  }

  /**
   * Initialize built-in tools
   */
  private initializeBuiltInTools(): void {
    // HTTP Request Tool
    this.builtInTools.set('http_request', {
      id: 'http_request',
      name: 'makeHttpRequest',
      description: 'Make HTTP requests to external APIs',
      nodeType: WorkflowNodeType.HTTP,
      nodeConfig: {},
      enabled: true,
      category: 'communication',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to request' },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            description: 'HTTP method',
          },
          headers: { type: 'object', description: 'Request headers' },
          body: { type: 'object', description: 'Request body for POST/PUT' },
          params: { type: 'object', description: 'Query parameters' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Response data' },
          status: { type: 'number', description: 'HTTP status code' },
          headers: { type: 'object', description: 'Response headers' },
        },
      },
    })

    // Variable Assignment Tool
    this.builtInTools.set('assign_variable', {
      id: 'assign_variable',
      name: 'assignVariable',
      description: 'Assign values to workflow variables',
      nodeType: WorkflowNodeType.VAR_ASSIGN,
      nodeConfig: {},
      enabled: true,
      category: 'data',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Variable value' },
        },
        required: ['name', 'value'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable name' },
          value: { type: 'string', description: 'Variable value' },
        },
      },
    })

    logger.info(`Initialized ${this.builtInTools.size} built-in tools`)
  }

  /**
   * Sanitize function name for AI providers
   */
  private sanitizeFunctionName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) // OpenAI function name limit
  }
}

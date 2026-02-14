// Import testing types first
import type { ICredentialTest } from './credential-testing'

// Basic value types
export type NodeValue = string | number | boolean | null | undefined
export type NodeData = { [key: string]: NodeValue | NodeValue[] | NodeData | NodeData[] }

// Core node interfaces
export interface INodeType {
  description: INodeTypeDescription
  execute?(context: IExecuteContext): Promise<NodeData[]>
}

export interface INodeTypeBaseDescription {
  displayName: string
  name: string
  icon?: string
  group?: string[]
  description?: string
  defaultVersion?: number
}

export interface INodeTypeDescription extends INodeTypeBaseDescription {
  version: number
  properties?: INodeProperty[]
  credentials?: ICredentialReference[]
}

export interface IVersionedNodeType {
  nodeVersions: { [version: number]: INodeType }
  description: INodeTypeBaseDescription
  currentVersion: number
}

export interface IExecuteContext {
  getNodeParameter(name: string): NodeValue
  getCredentials?(type: string): Promise<NodeData>
}

// Credential system
export interface ICredentialType {
  name: string
  displayName: string
  properties: INodeProperty[]
  authenticate?(credentials: NodeData): NodeData
  test?: ICredentialTest
  documentationUrl?: string

  // UI metadata for styling and display
  uiMetadata?: {
    icon?: string // Lucide icon name
    iconColor?: string // Tailwind color class
    backgroundColor?: string // Tailwind gradient classes
    borderColor?: string // Tailwind border color
    category?:
      | 'ai'
      | 'database'
      | 'data'
      | 'email'
      | 'auth'
      | 'social'
      | 'ecommerce'
      | 'storage'
      | 'other'
    brandColor?: string // Hex color for custom styling
  }
}

export interface ICredentialReference {
  name: string
  required?: boolean
}

// Property system
export type NodePropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'options'
  | 'json'
  | 'password'
  | 'notice'
  | 'hidden'

export interface INodePropertyOption {
  name: string
  value: NodeValue
  description?: string
}

export interface INodePropertyValidation {
  minLength?: number
  maxLength?: number
  pattern?: string | RegExp
  min?: number
  max?: number
  email?: boolean
  url?: boolean
  port?: boolean
  customValidator?: string
  errorMessage?: string
}

export interface INodeProperty {
  displayName: string
  name: string
  type: NodePropertyType
  default: NodeValue
  description?: string
  required?: boolean
  placeholder?: string
  options?: INodePropertyOption[]
  typeOptions?: {
    password?: boolean
    rows?: number
    multipleValues?: boolean
  }
  displayOptions?: {
    show?: { [key: string]: NodeValue[] }
    hide?: { [key: string]: NodeValue[] }
  }
  validation?: INodePropertyValidation
  doNotInherit?: boolean
}

// Minimal execution context your nodes expect.
// Keep this local so we don't pull in heavy external typings.
export interface ExecutionHelpers {
  // In many workflow engines this function expects `this` to be the context.
  // Using `this: unknown` keeps `.call(this, ...)` happy.
  requestOAuth2: (this: unknown, ...args: any[]) => Promise<any>

  assertBinaryData: (
    itemIndex: number,
    propertyName: string
  ) => {
    mimeType: string
    fileName: string
    // Add more fields if you need them later.
  }

  getBinaryDataBuffer: (itemIndex: number, propertyName: string) => Promise<Buffer | ArrayBuffer>
}

export interface ExecuteContext {
  getNodeParameter<T = unknown>(name: string, index: number, defaultValue?: T): T
  helpers: ExecutionHelpers
}

export type IExecuteFunctions = {
  executeWorkflow(
    workflowInfo: string,
    inputData?: string[],
    options?: {
      doNotWaitToFinish?: boolean
      parentExecution?: boolean
    }
  ): Promise<ExecuteWorkflowData>
}

export interface ExecuteWorkflowData {
  executionId: string
  data: Array<INodeExecutionData[] | null>
  waitTill?: Date | null
}

export type GenericValue = string | object | number | boolean | undefined | null

export interface IDataObject {
  [key: string]: GenericValue | IDataObject | GenericValue[] | IDataObject[]
}
export type BinaryFileType = 'text' | 'json' | 'image' | 'audio' | 'video' | 'pdf' | 'html'

export interface IBinaryData {
  [key: string]: string | number | undefined
  data: string
  mimeType: string
  fileType?: BinaryFileType
  fileName?: string
  directory?: string
  fileExtension?: string
  fileSize?: string // TODO: change this to number and store the actual value
  id?: string
}
export interface IBinaryKeyData {
  [key: string]: IBinaryData
}
export interface INodeExecutionData {
  [key: string]: IDataObject | number | string | undefined
  json: IDataObject
  binary?: IBinaryKeyData
  error?: string
  pairedItem?: number
  metadata?: {
    subExecution: number
  }
  evaluationData?: Record<string, GenericValue>

  sendMessage?: string
}

export interface IRequestOptions {
  auth?: {
    username: string
    password: string
    sendImmediately?: boolean
  }
  body?: IDataObject
  headers: IDataObject
  qs?: IDataObject
  method: IHttpRequestMethods
  url: string
  json?: boolean
  encoding?: string | null
}
export type INodeType = {}

export type IHttpRequestMethods = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'

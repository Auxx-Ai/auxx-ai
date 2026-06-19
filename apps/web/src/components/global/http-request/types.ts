// apps/web/src/components/global/http-request/types.ts

// HTTP methods enum
export enum Method {
  get = 'get',
  post = 'post',
  head = 'head',
  patch = 'patch',
  put = 'put',
  delete = 'delete',
}

// Body types enum
export enum BodyType {
  none = 'none',
  formData = 'form-data',
  xWwwFormUrlencoded = 'x-www-form-urlencoded',
  rawText = 'raw-text',
  json = 'json',
  binary = 'binary',
}

// Body payload value types
export enum BodyPayloadValueType {
  text = 'text',
  file = 'file',
}

// Authorization types
export enum AuthType {
  none = 'none',
  basic = 'basic',
  bearer = 'bearer',
  custom = 'custom',
  connection = 'connection',
}

// Value selector type (for file references)
export type ValueSelector = string[] // e.g., ["sys", "files"]

// Key-value pair type
export type KeyValue = {
  id?: string
  key: string
  keyEditorContent?: any // TipTap JSON for key editor
  value: string
  valueEditorContent?: any // TipTap JSON for value editor
  type?: string
  file?: ValueSelector
}

// Body payload item type
export type BodyPayloadItem = {
  id?: string
  key?: string
  type: BodyPayloadValueType
  file?: ValueSelector // when type is file
  value?: string // when type is text
}

// Body payload array
export type BodyPayload = BodyPayloadItem[]

// Body configuration
export type Body = { type: BodyType; data: BodyPayload }

// Authorization configuration
export type Authorization = {
  type: AuthType
  // For basic auth
  username?: string
  password?: string
  // For bearer/custom
  token?: string
  // For custom only
  header?: string
  // For connection — bound Credential id, resolved + applied at execute time
  connectionId?: string
}

// apps/web/src/components/fields/configs/model-field-configs.ts
import type { LucideIcon } from 'lucide-react'
import {
  Calendar,
  Mail,
  User,
  Phone,
  Users,
  UserCheck,
  Hash,
  FileText,
  Activity,
  AlertCircle,
  Tag,
  Clock,
  MessageSquare,
  AlignLeft,
  DollarSign,
  Package,
} from 'lucide-react'
import { ModelTypes, type ModelType, type SelectOption } from '@auxx/types/custom-field'
import { FieldType as FieldTypeEnum } from '@auxx/database/enums'
import type { FieldType } from '@auxx/database/types'

/**
 * Definition for a built-in field on an entity
 */
export interface BuiltInFieldDefinition {
  id: string
  name: string
  fieldType: FieldType
  icon?: LucideIcon
  readOnly?: boolean
  required?: boolean
  defaultValue?: any
  options?: SelectOption[]
  // Model-specific config for dynamic options (e.g., customerGroups)
  dynamicOptions?: {
    queryKey: string // e.g., 'contact.getGroups'
    mapFn: (data: any) => SelectOption[]
  }
}

/**
 * Configuration for an entity model's fields and mutations
 */
export interface EntityModelConfig {
  modelType: ModelType
  entityIdProp: string // 'contactId' | 'ticketId' | 'threadId' | 'companyId'
  builtInFields: BuiltInFieldDefinition[]

  // tRPC query keys
  queries: {
    getById: string // e.g., 'contact.getById'
    update?: string // e.g., 'contact.update'
  }
}

/**
 * Contact model field configuration
 */
export const contactFieldConfig: EntityModelConfig = {
  modelType: ModelTypes.CONTACT,
  entityIdProp: 'contactId',
  builtInFields: [
    {
      id: 'createdAt',
      name: 'Created',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'updatedAt',
      name: 'Last updated',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'status',
      name: 'Status',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: UserCheck,
      readOnly: false,
      required: false,
      defaultValue: 'ACTIVE',
      options: [
        { label: 'Active', value: 'ACTIVE' },
        { label: 'Inactive', value: 'INACTIVE' },
        { label: 'Spam', value: 'SPAM' },
        { label: 'Merged', value: 'MERGED' },
      ],
    },
    {
      id: 'email',
      name: 'Email address',
      fieldType: FieldTypeEnum.EMAIL,
      icon: Mail,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'name',
      name: 'Name',
      fieldType: FieldTypeEnum.NAME,
      icon: User,
      readOnly: false,
      required: false,
      defaultValue: { firstName: '', lastName: '' },
    },
    {
      id: 'phone',
      name: 'Phone number',
      fieldType: FieldTypeEnum.PHONE_INTL,
      icon: Phone,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'customerGroups',
      name: 'Groups',
      fieldType: FieldTypeEnum.MULTI_SELECT,
      icon: Users,
      readOnly: false,
      required: false,
      defaultValue: [],
      // options will be loaded dynamically from customer groups
      dynamicOptions: {
        queryKey: 'contact.getGroups',
        mapFn: (groups: any[]) => groups.map((group) => ({ label: group.name, value: group.id })),
      },
    },
  ],
  queries: {
    getById: 'contact.getById',
    update: 'contact.update',
  },
}

/**
 * Ticket model field configuration
 */
export const ticketFieldConfig: EntityModelConfig = {
  modelType: ModelTypes.TICKET,
  entityIdProp: 'ticketId',
  builtInFields: [
    {
      id: 'number',
      name: 'Ticket #',
      fieldType: FieldTypeEnum.TEXT,
      icon: Hash,
      readOnly: true,
      required: false,
      defaultValue: '',
    },
    {
      id: 'title',
      name: 'Title',
      fieldType: FieldTypeEnum.TEXT,
      icon: FileText,
      readOnly: false,
      required: true,
      defaultValue: '',
    },
    {
      id: 'description',
      name: 'Description',
      fieldType: FieldTypeEnum.RICH_TEXT,
      icon: AlignLeft,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'status',
      name: 'Status',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: Activity,
      readOnly: false,
      required: false,
      defaultValue: 'OPEN',
      options: [
        { label: 'Open', value: 'OPEN' },
        { label: 'In Progress', value: 'IN_PROGRESS' },
        { label: 'Resolved', value: 'RESOLVED' },
        { label: 'Closed', value: 'CLOSED' },
      ],
    },
    {
      id: 'priority',
      name: 'Priority',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: AlertCircle,
      readOnly: false,
      required: false,
      defaultValue: 'MEDIUM',
      options: [
        { label: 'Low', value: 'LOW' },
        { label: 'Medium', value: 'MEDIUM' },
        { label: 'High', value: 'HIGH' },
        { label: 'Urgent', value: 'URGENT' },
      ],
    },
    {
      id: 'type',
      name: 'Type',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: Tag,
      readOnly: false,
      required: true,
      defaultValue: 'SUPPORT',
      options: [
        { label: 'Support', value: 'SUPPORT' },
        { label: 'Bug', value: 'BUG' },
        { label: 'Feature Request', value: 'FEATURE_REQUEST' },
        { label: 'Question', value: 'QUESTION' },
      ],
    },
    {
      id: 'dueDate',
      name: 'Due Date',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: false,
      required: false,
      defaultValue: null,
    },
    {
      id: 'createdAt',
      name: 'Created',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'updatedAt',
      name: 'Last Updated',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
  ],
  queries: {
    getById: 'ticket.byId',
    update: 'ticket.update',
  },
}

/**
 * Thread/Conversation model field configuration
 */
export const threadFieldConfig: EntityModelConfig = {
  modelType: ModelTypes.THREAD,
  entityIdProp: 'threadId',
  builtInFields: [
    {
      id: 'subject',
      name: 'Subject',
      fieldType: FieldTypeEnum.TEXT,
      icon: Mail,
      readOnly: false,
      required: true,
      defaultValue: '',
    },
    {
      id: 'status',
      name: 'Status',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: Activity,
      readOnly: false,
      required: false,
      defaultValue: 'OPEN',
      options: [
        { label: 'Open', value: 'OPEN' },
        { label: 'Pending', value: 'PENDING' },
        { label: 'Resolved', value: 'RESOLVED' },
        { label: 'Closed', value: 'CLOSED' },
      ],
    },
    {
      id: 'type',
      name: 'Type',
      fieldType: FieldTypeEnum.SINGLE_SELECT,
      icon: MessageSquare,
      readOnly: false,
      required: false,
      defaultValue: 'EMAIL',
      options: [
        { label: 'Email', value: 'EMAIL' },
        { label: 'Chat', value: 'CHAT' },
        { label: 'SMS', value: 'SMS' },
      ],
    },
    {
      id: 'createdAt',
      name: 'Created',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'lastMessageAt',
      name: 'Last Message',
      fieldType: FieldTypeEnum.DATE,
      icon: Clock,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
  ],
  queries: {
    getById: 'thread.getById',
    update: 'thread.update',
  },
}

/**
 * Part model field configuration
 */
export const partFieldConfig: EntityModelConfig = {
  modelType: ModelTypes.PART,
  entityIdProp: 'partId',
  builtInFields: [
    {
      id: 'createdAt',
      name: 'Created',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'updatedAt',
      name: 'Last updated',
      fieldType: FieldTypeEnum.DATE,
      icon: Calendar,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
    {
      id: 'title',
      name: 'Title',
      fieldType: FieldTypeEnum.TEXT,
      icon: Package,
      readOnly: false,
      required: true,
      defaultValue: '',
    },
    {
      id: 'sku',
      name: 'SKU',
      fieldType: FieldTypeEnum.TEXT,
      icon: Hash,
      readOnly: false,
      required: true,
      defaultValue: '',
    },
    {
      id: 'description',
      name: 'Description',
      fieldType: FieldTypeEnum.TEXT,
      icon: FileText,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'category',
      name: 'Category',
      fieldType: FieldTypeEnum.TEXT,
      icon: Tag,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'hsCode',
      name: 'HS Code',
      fieldType: FieldTypeEnum.TEXT,
      icon: Hash,
      readOnly: false,
      required: false,
      defaultValue: '',
    },
    {
      id: 'cost',
      name: 'Cost',
      fieldType: FieldTypeEnum.CURRENCY,
      icon: DollarSign,
      readOnly: true,
      required: false,
      defaultValue: null,
    },
  ],
  queries: {
    getById: 'part.byId',
    update: 'part.update',
  },
}

/**
 * Record of all model configurations indexed by ModelType
 * Note: Only system models with built-in fields are included here
 */
export const modelConfigs: Partial<Record<ModelType, EntityModelConfig>> = {
  [ModelTypes.CONTACT]: contactFieldConfig,
  [ModelTypes.TICKET]: ticketFieldConfig,
  [ModelTypes.THREAD]: threadFieldConfig,
  [ModelTypes.PART]: partFieldConfig,
}

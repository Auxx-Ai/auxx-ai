// packages/lib/src/resources/schema-read.ts

import { findCachedResource, getCachedResources } from '../cache/org-cache-helpers'
import type { FieldOptions } from '../custom-fields/field-options'
import type { CapabilityView } from '../permissions/capabilities/capability-view'
import type { FieldCapabilities, FieldValidation, Resource, ResourceField } from './registry'

/** One field of a {@link ResourceNode}; `key` is the key `RecordNode.values` uses. */
export interface ResourceFieldNode {
  id: string
  key: string
  systemAttribute?: string
  label: string
  type: ResourceField['type']
  fieldType?: ResourceField['fieldType']
  options?: FieldOptions
  capabilities: FieldCapabilities
  validation?: FieldValidation
  relationship?: {
    relationshipType: 'belongs_to' | 'has_one' | 'has_many' | 'many_to_many'
    /** `entityDefinitionId:fieldId` of the inverse side, when one exists. */
    inverseResourceFieldId: string | null
  }
  appSlug?: string
  appFieldKey?: string
  dataConnectorId?: string
}

/** The schema an app can act on — a projection of the cached `Resource`, storage internals dropped. */
export interface ResourceNode {
  id: string
  entityDefinitionId: string
  apiSlug: string
  entityType?: string
  type: 'system' | 'custom'
  label: string
  plural: string
  icon: string
  color: string
  dataConnectorId?: string
  fields: ResourceFieldNode[]
}

function projectField(field: ResourceField): ResourceFieldNode {
  const node: ResourceFieldNode = {
    id: field.id,
    key: field.key,
    label: field.label,
    type: field.type,
    capabilities: field.capabilities,
  }
  if (field.systemAttribute) node.systemAttribute = field.systemAttribute
  if (field.fieldType) node.fieldType = field.fieldType
  if (field.options) node.options = field.options
  if (field.validation) node.validation = field.validation
  if (field.relationship) {
    node.relationship = {
      relationshipType: field.relationship.relationshipType,
      inverseResourceFieldId: field.relationship.inverseResourceFieldId,
    }
  }
  if (field.appSlug) node.appSlug = field.appSlug
  if (field.appFieldKey) node.appFieldKey = field.appFieldKey
  if (field.dataConnectorId) node.dataConnectorId = field.dataConnectorId
  return node
}

export function projectResource(resource: Resource): ResourceNode {
  const node: ResourceNode = {
    id: resource.id,
    entityDefinitionId: resource.entityDefinitionId,
    apiSlug: resource.apiSlug,
    type: resource.type,
    label: resource.label,
    plural: resource.plural,
    icon: resource.icon,
    color: resource.color,
    fields: resource.fields.map(projectField),
  }
  if (resource.entityType) node.entityType = resource.entityType
  if (resource.type === 'custom' && resource.dataConnectorId) {
    node.dataConnectorId = resource.dataConnectorId
  }
  return node
}

/**
 * Every resource the principal holds def presence on. `hasDefPresence` is the
 * documented gate for def metadata surfaces; a def without it is absent, not an error.
 */
export async function listResourcesFor(
  orgId: string,
  capabilities: CapabilityView
): Promise<ResourceNode[]> {
  const resources = await getCachedResources(orgId)
  return resources
    .filter((r) => capabilities.hasDefPresence(r.entityDefinitionId))
    .map(projectResource)
}

/** One resource by def id, `entityType` or `apiSlug`; null when missing or not visible — indistinguishable on purpose. */
export async function getResourceFor(
  orgId: string,
  capabilities: CapabilityView,
  idOrSlug: string
): Promise<ResourceNode | null> {
  const resource = await findCachedResource(orgId, idOrSlug)
  if (!resource || !capabilities.hasDefPresence(resource.entityDefinitionId)) return null
  return projectResource(resource)
}

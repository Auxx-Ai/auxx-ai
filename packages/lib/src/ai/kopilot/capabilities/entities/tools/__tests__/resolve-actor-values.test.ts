// packages/lib/src/ai/kopilot/capabilities/entities/tools/__tests__/resolve-actor-values.test.ts

import { FieldType } from '@auxx/database/enums'
import { toActorId } from '@auxx/types/actor'
import { toFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedGroup, OrgMemberInfo } from '../../../../../../cache/org-cache-keys'
import type { ResourceField } from '../../../../../../resources/registry/field-types'
import type { SystemResource } from '../../../../../../resources/registry/types'
import { BaseType } from '../../../../../../workflow-engine/core/types'

vi.mock('../../../../../../cache/org-cache-helpers', () => ({
  getCachedMembers: vi.fn(),
  getCachedGroups: vi.fn(),
}))

import { getCachedGroups, getCachedMembers } from '../../../../../../cache/org-cache-helpers'
import { resolveActorValues, resolveActorValuesFlat } from '../resolve-actor-values'

const USER_ME = 'u_me'
const USER_SARAH_1 = 'u_sarah1'
const USER_SARAH_2 = 'u_sarah2'
const USER_MARKUS = 'u_markus'
const GROUP_SUPPORT = 'g_support'

const members: OrgMemberInfo[] = [
  {
    id: 'm_1',
    userId: USER_ME,
    organizationId: 'org_1',
    role: 'OWNER',
    status: 'active',
    user: {
      id: USER_ME,
      name: 'Me Myself',
      email: 'me@example.com',
      image: null,
      userType: 'human',
    },
  },
  {
    id: 'm_2',
    userId: USER_SARAH_1,
    organizationId: 'org_1',
    role: 'USER',
    status: 'active',
    user: {
      id: USER_SARAH_1,
      name: 'Sarah Chen',
      email: 'sarah.chen@example.com',
      image: null,
      userType: 'human',
    },
  },
  {
    id: 'm_3',
    userId: USER_SARAH_2,
    organizationId: 'org_1',
    role: 'USER',
    status: 'active',
    user: {
      id: USER_SARAH_2,
      name: 'Sarah',
      email: 'sarah.ng@example.com',
      image: null,
      userType: 'human',
    },
  },
  {
    id: 'm_4',
    userId: USER_MARKUS,
    organizationId: 'org_1',
    role: 'ADMIN',
    status: 'active',
    user: {
      id: USER_MARKUS,
      name: 'Sarah', // second "Sarah" → ambiguous on exact name
      email: 'markus@example.com',
      image: null,
      userType: 'human',
    },
  },
]

const groups: CachedGroup[] = [
  {
    id: GROUP_SUPPORT,
    displayName: 'Support',
    secondaryDisplayValue: null,
    avatarUrl: null,
    metadata: {},
  },
]

function actorField(overrides: Partial<ResourceField> = {}): ResourceField {
  return {
    id: toFieldId('assignee'),
    key: 'assignee',
    label: 'Assignee',
    type: BaseType.ACTOR,
    fieldType: FieldType.ACTOR,
    isSystem: true,
    systemAttribute: 'assigned_to_id',
    dbColumn: 'assignedToId',
    nullable: true,
    capabilities: {
      filterable: true,
      sortable: false,
      creatable: true,
      updatable: true,
      configurable: false,
    },
    options: { actor: { target: 'user', multiple: false } },
    ...overrides,
  }
}

function stringField(): ResourceField {
  return {
    id: toFieldId('title'),
    key: 'title',
    label: 'Title',
    type: BaseType.STRING,
    fieldType: FieldType.TEXT,
    isSystem: true,
    systemAttribute: 'title',
    dbColumn: 'title',
    nullable: false,
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: true,
      updatable: true,
      configurable: false,
    },
  }
}

function makeResource(fields: ResourceField[]): SystemResource {
  return {
    id: 'ticket',
    type: 'system',
    label: 'Ticket',
    plural: 'Tickets',
    icon: 'ticket',
    color: 'blue',
    apiSlug: 'tickets',
    entityDefinitionId: 'ticket',
    entityType: 'ticket',
    isVisible: true,
    dbName: 'ticket',
    fields,
    display: {
      identifierField: 'id',
      primaryDisplayField: null,
      secondaryDisplayField: null,
      avatarField: null,
      searchFields: [],
      orgScopingStrategy: 'direct',
    },
  }
}

const ctx = { organizationId: 'org_1', userId: USER_ME }

beforeEach(() => {
  vi.mocked(getCachedMembers).mockResolvedValue(members)
  vi.mocked(getCachedGroups).mockResolvedValue(groups)
})

describe('resolveActorValues', () => {
  it('passes through a valid user: ActorId', async () => {
    const resource = makeResource([actorField()])
    const expected = toActorId('user', USER_MARKUS)

    const result = await resolveActorValues({ assignee: expected }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(expected)
  })

  it('resolves "me" to the caller actorId', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assignee: 'me' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(toActorId('user', USER_ME))
  })

  it('resolves "@me" and other self keywords case-insensitively', async () => {
    const resource = makeResource([actorField()])

    for (const keyword of ['@me', 'Myself', 'SELF', 'I']) {
      const result = await resolveActorValues({ assignee: keyword }, resource, ctx)
      expect(result.errors).toEqual([])
      expect(result.values.assignee).toBe(toActorId('user', USER_ME))
    }
  })

  it('resolves nested { actorType, id: "me" }', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues(
      { assignee: { actorType: 'user', id: 'me' } },
      resource,
      ctx
    )

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(toActorId('user', USER_ME))
  })

  it('resolves a member by email', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assignee: 'markus@example.com' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(toActorId('user', USER_MARKUS))
  })

  it('resolves a unique name', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assignee: 'Sarah Chen' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(toActorId('user', USER_SARAH_1))
  })

  it('returns an ambiguous error for duplicate names with candidates', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assignee: 'Sarah' }, resource, ctx)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('ambiguous')
    expect(result.errors[0].candidates.map((c) => c.actorId)).toEqual([
      toActorId('user', USER_SARAH_2),
      toActorId('user', USER_MARKUS),
    ])
    expect(result.values.assignee).toBe('Sarah') // input preserved
  })

  it('returns not_found for a hallucinated actorId with candidates', async () => {
    const resource = makeResource([actorField()])
    const bogus = toActorId('user', 'u_ghost')

    const result = await resolveActorValues({ assignee: bogus }, resource, ctx)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('not_found')
    expect(result.errors[0].candidates.length).toBeGreaterThan(0)
  })

  it('does not touch non-actor fields', async () => {
    const resource = makeResource([actorField(), stringField()])

    const result = await resolveActorValues({ assignee: 'me', title: 'me' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBe(toActorId('user', USER_ME))
    expect(result.values.title).toBe('me')
  })

  it('walks arrays for multi-actor fields', async () => {
    const resource = makeResource([
      actorField({
        options: { actor: { target: 'user', multiple: true } },
        key: 'reviewers',
        id: toFieldId('reviewers'),
        systemAttribute: undefined,
      }),
    ])

    const result = await resolveActorValues(
      { reviewers: ['me', 'markus@example.com'] },
      resource,
      ctx
    )

    expect(result.errors).toEqual([])
    expect(result.values.reviewers).toEqual([
      toActorId('user', USER_ME),
      toActorId('user', USER_MARKUS),
    ])
  })

  it('does not resolve self keyword for group-target fields', async () => {
    const resource = makeResource([
      actorField({
        options: { actor: { target: 'group', multiple: false } },
        key: 'team',
        id: toFieldId('team'),
        systemAttribute: undefined,
      }),
    ])

    const result = await resolveActorValues({ team: 'me' }, resource, ctx)

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('not_found')
  })

  it('resolves a group by name when target is group', async () => {
    const resource = makeResource([
      actorField({
        options: { actor: { target: 'group', multiple: false } },
        key: 'team',
        id: toFieldId('team'),
        systemAttribute: undefined,
      }),
    ])

    const result = await resolveActorValues({ team: 'Support' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.team).toBe(toActorId('group', GROUP_SUPPORT))
  })

  it('accepts input under the systemAttribute key', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assigned_to_id: 'me' }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assigned_to_id).toBe(toActorId('user', USER_ME))
  })

  it('leaves null untouched (clear operation)', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValues({ assignee: null }, resource, ctx)

    expect(result.errors).toEqual([])
    expect(result.values.assignee).toBeNull()
  })

  it('resolveActorValuesFlat resolves the flat pair shape used by bulk_update', async () => {
    const resource = makeResource([actorField()])

    const result = await resolveActorValuesFlat(
      [{ fieldId: 'assignee', value: 'me' }],
      resource,
      ctx
    )

    expect(result.errors).toEqual([])
    expect(result.pairs[0].value).toBe(toActorId('user', USER_ME))
  })
})

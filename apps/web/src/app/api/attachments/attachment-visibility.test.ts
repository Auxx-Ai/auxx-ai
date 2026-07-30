// apps/web/src/app/api/attachments/attachment-visibility.test.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `canViewAttachment` — the gate behind `api/attachments/[attachmentId]/download`
 * and `/thumbnail`, and the largest untested authorization predicate in the
 * permissions plan.
 *
 * It used to be `if (attachment.entityType !== 'MESSAGE') return true`: every
 * non-mail attachment in the org was readable by any authenticated member, and
 * an unknown `entityType` (the column is free text) was readable too. It is now
 * a fail-closed switch that resolves the owning parent row inside the caller's
 * org and defers to that parent's own gate.
 *
 * Two invariants are what these tests exist to pin:
 *  - **Fails closed** — unknown `entityType`, missing attachment, and a parent
 *    that does not resolve *in this org* all return `false`.
 *  - **Capability-first, DB-second** — each arm runs its free predicate before
 *    issuing a parent lookup, and `getCapabilities` is lazy, so `MESSAGE` /
 *    `CUSTOM_FIELD` / the unknown default never read capabilities at all.
 *
 * Behavioral: every check runs against a REAL `CapabilitySet`. Only the DB, the
 * capability fetch, and the four collaborators the arms delegate to are stubbed.
 * The observed side effect is the SECOND `database.select` — the parent lookup —
 * so "no parent read happened" is an assertion, not an implementation detail.
 */

const {
  select,
  getCapabilities,
  getCachedResources,
  getCachedUserInstanceGrants,
  getThreadLens,
  assertWorkflowRunNotSystemOwned,
  loadOwnVisit,
  and,
  eq,
  isNull,
} = vi.hoisted(() => ({
  select: vi.fn(),
  getCapabilities: vi.fn(),
  getCachedResources: vi.fn(),
  getCachedUserInstanceGrants: vi.fn(),
  getThreadLens: vi.fn(),
  assertWorkflowRunNotSystemOwned: vi.fn(),
  loadOwnVisit: vi.fn(),
  and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  isNull: vi.fn((value: unknown) => ({ op: 'isNull', value })),
}))

vi.mock('@auxx/database', () => ({
  database: { select },
  schema: {
    Attachment: {
      id: 'Attachment.id',
      entityType: 'Attachment.entityType',
      entityId: 'Attachment.entityId',
      createdById: 'Attachment.createdById',
      organizationId: 'Attachment.organizationId',
    },
    Message: {
      id: 'Message.id',
      threadId: 'Message.threadId',
      organizationId: 'Message.organizationId',
    },
    Comment: {
      id: 'Comment.id',
      entityDefinitionId: 'Comment.entityDefinitionId',
      entityId: 'Comment.entityId',
      organizationId: 'Comment.organizationId',
      deletedAt: 'Comment.deletedAt',
    },
    FieldValue: {
      id: 'FieldValue.id',
      entityDefinitionId: 'FieldValue.entityDefinitionId',
      organizationId: 'FieldValue.organizationId',
    },
    EntityInstance: {
      id: 'EntityInstance.id',
      entityDefinitionId: 'EntityInstance.entityDefinitionId',
      organizationId: 'EntityInstance.organizationId',
    },
    Article: {
      id: 'Article.id',
      homeKnowledgeBaseId: 'Article.homeKnowledgeBaseId',
      organizationId: 'Article.organizationId',
    },
    KnowledgeBase: { id: 'KnowledgeBase.id', organizationId: 'KnowledgeBase.organizationId' },
    ChatWidget: { id: 'ChatWidget.id', organizationId: 'ChatWidget.organizationId' },
    VisitQcItem: {
      id: 'VisitQcItem.id',
      visitId: 'VisitQcItem.visitId',
      organizationId: 'VisitQcItem.organizationId',
    },
  },
}))

vi.mock('drizzle-orm', () => ({ and, eq, isNull }))

// The `@auxx/lib/permissions` barrel HANGS under vitest (get-capabilities,
// record-view-scope, overage-*) — stub it, but keep `PermissionKey` REAL via the
// deep registry path, because the `visit_qc_item` arm reads a key off it.
vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  const { buildDefIdToDefinitionId, buildDefIdToSlug } = await import(
    '@auxx/lib/permissions/capabilities/resolve-capability-inputs'
  )
  return { buildDefIdToDefinitionId, buildDefIdToSlug, PermissionKey, getCapabilities }
})

vi.mock('@auxx/lib/cache', () => ({ getCachedResources, getCachedUserInstanceGrants }))
vi.mock('@auxx/lib/permissions/visibility', () => ({ getThreadLens }))
// Both of these are `await import(...)`ed INSIDE their arm — `vi.mock`
// intercepts dynamic imports the same as static ones.
vi.mock('@auxx/lib/workflows', () => ({ assertWorkflowRunNotSystemOwned }))
vi.mock('@auxx/lib/dispatch', () => ({ loadOwnVisit }))

// Deep path on purpose — the barrel hangs (see above).
const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { canViewAttachment } = await import('./attachment-visibility')

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'
/** A second member of the SAME org — the `CUSTOM_FIELD` non-uploader. */
const OTHER_USER_ID = 'usr_cuid111111111111111111111'
const ATTACHMENT_ID = 'att_cuid000000000000000000000'

const MESSAGE_ID = 'msg_cuid000000000000000000000'
const THREAD_ID = 'thr_cuid000000000000000000000'
const COMMENT_ID = 'cmt_cuid000000000000000000000'
const FIELD_VALUE_ID = 'fvl_cuid000000000000000000000'
const INSTANCE_ID = 'ins_cuid000000000000000000000'
const ARTICLE_ID = 'art_cuid000000000000000000000'
const KB_ID = 'kb_cuid0000000000000000000000'
const WIDGET_ID = 'wgt_cuid000000000000000000000'
const RUN_ID = 'run_cuid000000000000000000000'
const WORKFLOW_APP_ID = 'wfa_cuid000000000000000000000'
const QC_ITEM_ID = 'qci_cuid000000000000000000000'
const VISIT_ID = 'vis_cuid000000000000000000000'
/** The `entityDefinitionId` the COMMENT / FIELD_VALUE / TICKET arms gate on. */
const DEF_ID = 'edf_cuid000000000000000000000'
const THREAD_DEF_ID = 'edf_thread00000000000000000000'
const INBOX_DEF_ID = 'edf_inbox000000000000000000000'
const PERSONAL_INBOX_DEF_ID = 'edf_personal000000000000000000'

const RESOURCES = [
  {
    id: 'res_record',
    apiSlug: 'work-orders',
    entityDefinitionId: DEF_ID,
    entityType: 'work_order',
  },
  {
    id: 'res_thread',
    apiSlug: 'threads',
    entityDefinitionId: THREAD_DEF_ID,
    entityType: 'thread',
  },
  {
    id: 'res_inbox',
    apiSlug: 'inboxes',
    entityDefinitionId: INBOX_DEF_ID,
    entityType: 'inbox',
  },
  {
    id: 'res_personal_inbox',
    apiSlug: 'personal-inboxes',
    entityDefinitionId: PERSONAL_INBOX_DEF_ID,
    entityType: 'personal_inbox',
  },
]

/**
 * Rows handed to successive `.limit(1)` calls, IN ORDER. Most arms issue TWO
 * selects (the attachment, then its parent) off the same `database.select`
 * stub — a single `mockResolvedValue` would serve the attachment row twice and
 * make every test pass for the wrong reason.
 */
let selectQueue: unknown[][] = []
/** The `.from(table)` `id` sentinel of each select, in order — proves WHICH reads ran. */
const fromTables: string[] = []

/** Queue one result set per upcoming `database.select(...)` chain. */
function queueRows(...rows: unknown[][]) {
  selectQueue.push(...rows)
}

/** The `Attachment` projection row the first select always resolves. */
function attachmentRow(entityType: string, entityId: string, createdById = OTHER_USER_ID) {
  return [{ entityType, entityId, createdById }]
}

/**
 * A real `CapabilitySet` composing `levels`, optionally with explicit
 * instance-access rows. No shared factory exists in this repo — the sibling
 * permission tests each hand-roll one, and this mirrors theirs.
 */
function capabilitiesWith(
  levels: Partial<Record<Area, Level>>,
  opts: {
    role?: 'OWNER' | 'ADMIN' | 'USER'
    instances?: Record<string, ResourcePermission>
  } = {}
) {
  const instances = opts.instances ?? {}
  return new CapabilitySet(
    new Set(expandLevelsToKeys(levels)),
    {},
    opts.role ?? 'USER',
    'full',
    undefined,
    undefined,
    undefined,
    instances,
    new Set(Object.keys(instances))
  )
}

/** Make `getCapabilities` resolve a real `CapabilitySet` composing `levels`. */
function memberHolding(
  levels: Partial<Record<Area, Level>>,
  opts: Parameters<typeof capabilitiesWith>[1] = {}
) {
  getCapabilities.mockResolvedValue(capabilitiesWith(levels, opts))
}

/** The call under test, always as {@link USER_ID} inside {@link ORG_ID}. */
const canView = () => canViewAttachment(ATTACHMENT_ID, USER_ID, ORG_ID)

beforeEach(() => {
  selectQueue = []
  fromTables.length = 0
  eq.mockClear()
  and.mockClear()
  isNull.mockClear()
  select.mockReset().mockImplementation(() => ({
    from: (table: { id: string }) => {
      fromTables.push(table.id)
      return { where: () => ({ limit: async () => selectQueue.shift() ?? [] }) }
    },
  }))
  // Default to a member with nothing — every grant test opts in explicitly.
  getCapabilities.mockReset().mockResolvedValue(capabilitiesWith({}))
  getCachedResources.mockReset().mockResolvedValue(RESOURCES)
  getCachedUserInstanceGrants.mockReset().mockResolvedValue({ userId: USER_ID })
  getThreadLens.mockReset().mockResolvedValue('none')
  assertWorkflowRunNotSystemOwned.mockReset().mockResolvedValue(WORKFLOW_APP_ID)
  loadOwnVisit.mockReset().mockResolvedValue({ id: VISIT_ID })
})

describe('canViewAttachment — the attachment row itself', () => {
  it('denies an attachment id that does not resolve in this org', async () => {
    // The read is org-scoped, so a foreign-org attachment id is absent here too.
    // Invisible ≍ nonexistent keeps attachment ids unprobeable across orgs.
    queueRows([])
    await expect(canView()).resolves.toBe(false)
    expect(select).toHaveBeenCalledTimes(1)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('scopes the attachment lookup by organization', async () => {
    queueRows(attachmentRow('CUSTOM_FIELD', 'field-logo', USER_ID))
    await canView()
    expect(eq).toHaveBeenCalledWith('Attachment.id', ATTACHMENT_ID)
    expect(eq).toHaveBeenCalledWith('Attachment.organizationId', ORG_ID)
  })

  it('denies an unknown entityType — the fail-closed default', async () => {
    // `Attachment.entityType` is a free-text column. Before the rewrite the
    // predicate was `entityType !== 'MESSAGE' → true`, so any value a future
    // writer invents shipped WORLD-READABLE inside the org. It must now ship
    // denied until an arm is added for it.
    queueRows(attachmentRow('SOMETHING_NEW', 'whatever-id'))
    await expect(canView()).resolves.toBe(false)
    // No parent lookup, and not even a capability read — the switch falls
    // through before either.
    expect(select).toHaveBeenCalledTimes(1)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('canViewAttachment — MESSAGE (unchanged; must not regress)', () => {
  it('grants a caller holding the `full` lens on the parent thread', async () => {
    queueRows(attachmentRow('MESSAGE', MESSAGE_ID), [{ threadId: THREAD_ID }])
    getThreadLens.mockResolvedValue('full')
    await expect(canView()).resolves.toBe(true)
    expect(getThreadLens).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      { userId: USER_ID },
      THREAD_ID
    )
  })

  it('denies the `read` lens — mail attachments are full-tier', async () => {
    queueRows(attachmentRow('MESSAGE', MESSAGE_ID), [{ threadId: THREAD_ID }])
    getThreadLens.mockResolvedValue('read')
    await expect(canView()).resolves.toBe(false)
  })

  it('denies the `none` lens', async () => {
    queueRows(attachmentRow('MESSAGE', MESSAGE_ID), [{ threadId: THREAD_ID }])
    getThreadLens.mockResolvedValue('none')
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a message that does not resolve in this org, before the lens read', async () => {
    queueRows(attachmentRow('MESSAGE', MESSAGE_ID), [])
    await expect(canView()).resolves.toBe(false)
    expect(getThreadLens).not.toHaveBeenCalled()
  })

  it('reads no capabilities at all on the mail path', async () => {
    queueRows(attachmentRow('MESSAGE', MESSAGE_ID), [{ threadId: THREAD_ID }])
    getThreadLens.mockResolvedValue('full')
    await canView()
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('canViewAttachment — COMMENT', () => {
  it('denies `comments: None` before reading the comment row', async () => {
    // THE leak this rewrite closes. `COMMENT` fell into the old
    // `entityType !== 'MESSAGE' → true` branch, so ANY authenticated org member
    // got the bytes of any comment attachment they could name — including a
    // member with no records access whatsoever. Comment attachments are the
    // richest of these (customers' documents pasted into internal notes).
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [{ entityDefinitionId: DEF_ID }])
    memberHolding({ [Area.records]: Level.None, [Area.comments]: Level.None })
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id'])
  })

  it('grants a member with comments read and a visible, existing record parent', async () => {
    queueRows(
      attachmentRow('COMMENT', COMMENT_ID),
      [{ entityDefinitionId: DEF_ID, entityId: INSTANCE_ID }],
      [{ id: INSTANCE_ID }]
    )
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Read })
    await expect(canView()).resolves.toBe(true)
    expect(fromTables).toEqual(['Attachment.id', 'Comment.id', 'EntityInstance.id'])
  })

  it('canonicalizes an apiSlug comment host before checking the parent definition', async () => {
    queueRows(
      attachmentRow('COMMENT', COMMENT_ID),
      [{ entityDefinitionId: 'work-orders', entityId: INSTANCE_ID }],
      [{ id: INSTANCE_ID }]
    )
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Read })

    await expect(canView()).resolves.toBe(true)
    expect(eq).toHaveBeenCalledWith('EntityInstance.entityDefinitionId', DEF_ID)
  })

  it('denies a record parent hidden by the definition gate before reading that record', async () => {
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [
      { entityDefinitionId: DEF_ID, entityId: INSTANCE_ID },
    ])
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.None })
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id', 'Comment.id'])
  })

  it('denies an orphaned record comment even when its definition is visible', async () => {
    queueRows(
      attachmentRow('COMMENT', COMMENT_ID),
      [{ entityDefinitionId: DEF_ID, entityId: INSTANCE_ID }],
      []
    )
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Read })
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a comment that does not resolve in this org after the area front door', async () => {
    // The parent lookup — not just the attachment lookup — is what fails closed.
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [])
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id', 'Comment.id'])
    expect(getCapabilities).toHaveBeenCalledOnce()
  })

  it('scopes the comment lookup by organization', async () => {
    queueRows(
      attachmentRow('COMMENT', COMMENT_ID),
      [{ entityDefinitionId: DEF_ID, entityId: INSTANCE_ID }],
      [{ id: INSTANCE_ID }]
    )
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Read })
    await canView()
    expect(eq).toHaveBeenCalledWith('Comment.id', COMMENT_ID)
    expect(eq).toHaveBeenCalledWith('Comment.organizationId', ORG_ID)
  })

  it('excludes soft-deleted comments from attachment visibility', async () => {
    queueRows(
      attachmentRow('COMMENT', COMMENT_ID),
      [{ entityDefinitionId: DEF_ID, entityId: INSTANCE_ID }],
      [{ id: INSTANCE_ID }]
    )
    memberHolding({ [Area.comments]: Level.Read, [Area.records]: Level.Read })

    await expect(canView()).resolves.toBe(true)
    expect(isNull).toHaveBeenCalledWith('Comment.deletedAt')
  })

  it('grants a comment on a thread definition CUID at any visible lens', async () => {
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [
      { entityDefinitionId: THREAD_DEF_ID, entityId: THREAD_ID },
    ])
    memberHolding({ [Area.comments]: Level.Read, [Area.inboxes]: Level.Read })
    getThreadLens.mockResolvedValue('metadata')

    await expect(canView()).resolves.toBe(true)
    expect(getThreadLens).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      { userId: USER_ID },
      THREAD_ID
    )
  })

  it('denies a thread comment at the `none` lens', async () => {
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [
      { entityDefinitionId: THREAD_DEF_ID, entityId: THREAD_ID },
    ])
    memberHolding({ [Area.comments]: Level.Read, [Area.inboxes]: Level.Read })
    getThreadLens.mockResolvedValue('none')

    await expect(canView()).resolves.toBe(false)
  })

  it('denies a thread comment at `inboxes: None` before reading the lens', async () => {
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [
      { entityDefinitionId: THREAD_DEF_ID, entityId: THREAD_ID },
    ])
    memberHolding({ [Area.comments]: Level.Read, [Area.inboxes]: Level.None })

    await expect(canView()).resolves.toBe(false)
    expect(getCachedUserInstanceGrants).not.toHaveBeenCalled()
    expect(getThreadLens).not.toHaveBeenCalled()
  })

  it.each([
    INBOX_DEF_ID,
    PERSONAL_INBOX_DEF_ID,
  ])('denies unsupported inbox comment host %s', async (entityDefinitionId) => {
    queueRows(attachmentRow('COMMENT', COMMENT_ID), [{ entityDefinitionId, entityId: INSTANCE_ID }])
    memberHolding({
      [Area.comments]: Level.Read,
      [Area.inboxes]: Level.Full,
      [Area.records]: Level.Full,
    })

    await expect(canView()).resolves.toBe(false)
    expect(getThreadLens).not.toHaveBeenCalled()
    expect(fromTables).toEqual(['Attachment.id', 'Comment.id'])
  })
})

describe('canViewAttachment — FIELD_VALUE', () => {
  it('grants a member who can view the owning definition', async () => {
    queueRows(attachmentRow('FIELD_VALUE', FIELD_VALUE_ID), [{ entityDefinitionId: DEF_ID }])
    memberHolding({ [Area.records]: Level.Read })
    await expect(canView()).resolves.toBe(true)
  })

  it('denies a member composing `records: None`', async () => {
    queueRows(attachmentRow('FIELD_VALUE', FIELD_VALUE_ID), [{ entityDefinitionId: DEF_ID }])
    memberHolding({ [Area.records]: Level.None })
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a field value that does not resolve in this org', async () => {
    queueRows(attachmentRow('FIELD_VALUE', FIELD_VALUE_ID), [])
    memberHolding({ [Area.records]: Level.Full })
    await expect(canView()).resolves.toBe(false)
  })
})

describe('canViewAttachment — CUSTOM_FIELD (transient staging uploads)', () => {
  it('grants the uploader without any parent lookup', async () => {
    // `entityId` is the synthetic `field-${fieldRef}` of an in-progress form —
    // there is no owning record to resolve, so the uploader is the only viewer.
    queueRows(attachmentRow('CUSTOM_FIELD', 'field-contract', USER_ID))
    await expect(canView()).resolves.toBe(true)
    expect(select).toHaveBeenCalledTimes(1)
    expect(fromTables).toEqual(['Attachment.id'])
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('denies a DIFFERENT member of the same org, still without a parent lookup', async () => {
    queueRows(attachmentRow('CUSTOM_FIELD', 'field-contract', OTHER_USER_ID))
    memberHolding({ [Area.records]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    // The arm has nothing to look up: a second select here would mean it grew a
    // parent resolution that the synthetic `entityId` cannot possibly satisfy.
    expect(select).toHaveBeenCalledTimes(1)
    expect(fromTables).toEqual(['Attachment.id'])
  })
})

describe('canViewAttachment — TICKET (retired)', () => {
  // `TicketProcessor` and the `Ticket` table are both gone. Tickets are ordinary
  // `EntityInstance` records now, and the processor's `validateEntityAccess` read a
  // `schema.Ticket` that no longer existed — so it threw rather than writing, and no
  // `TICKET` attachment has ever been produced (confirmed: zero rows). The arm was
  // removed with the processor; this pins that removal to the fail-closed default.
  it('denies — the arm is gone, so it falls through to the fail-closed default', async () => {
    queueRows(attachmentRow('TICKET', INSTANCE_ID))
    memberHolding({ [Area.records]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id'])
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('canViewAttachment — ARTICLE (inherits the home KB)', () => {
  it('grants a member holding `knowledgeBase: Read` on the article home KB', async () => {
    queueRows(attachmentRow('ARTICLE', ARTICLE_ID), [{ homeKnowledgeBaseId: KB_ID }])
    memberHolding({ [Area.knowledgeBase]: Level.Read })
    await expect(canView()).resolves.toBe(true)
  })

  it('denies a member composing `knowledgeBase: None`', async () => {
    queueRows(attachmentRow('ARTICLE', ARTICLE_ID), [{ homeKnowledgeBaseId: KB_ID }])
    memberHolding({ [Area.knowledgeBase]: Level.None })
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a member holding an explicit `none` row on the home KB', async () => {
    // Area wide open, and only the per-instance restriction stands between the
    // caller and the attachment — the gate must key on the HOME KB, not the
    // article id.
    queueRows(attachmentRow('ARTICLE', ARTICLE_ID), [{ homeKnowledgeBaseId: KB_ID }])
    memberHolding(
      { [Area.knowledgeBase]: Level.Full },
      { instances: { [KB_ID]: ResourcePermission.none } }
    )
    await expect(canView()).resolves.toBe(false)
  })

  it('denies an article that does not resolve in this org, before any capability read', async () => {
    queueRows(attachmentRow('ARTICLE', ARTICLE_ID), [])
    memberHolding({ [Area.knowledgeBase]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id', 'Article.id'])
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('canViewAttachment — KNOWLEDGE_BASE', () => {
  it('grants a member holding `knowledgeBase: Read` on an existing KB', async () => {
    queueRows(attachmentRow('KNOWLEDGE_BASE', KB_ID), [{ id: KB_ID }])
    memberHolding({ [Area.knowledgeBase]: Level.Read })
    await expect(canView()).resolves.toBe(true)
  })

  it('denies a member holding an explicit `none` row on that KB', async () => {
    queueRows(attachmentRow('KNOWLEDGE_BASE', KB_ID), [{ id: KB_ID }])
    memberHolding(
      { [Area.knowledgeBase]: Level.Full },
      { instances: { [KB_ID]: ResourcePermission.none } }
    )
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a forged KB id before probing instance access', async () => {
    // The existence check runs first on purpose: without it a forged id would
    // fall through to `canViewInstance`, which answers from the area fallback
    // and would happily grant a KB that is not in this org.
    queueRows(attachmentRow('KNOWLEDGE_BASE', KB_ID), [])
    memberHolding({ [Area.knowledgeBase]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

describe('canViewAttachment — CHAT_WIDGET (org membership only, deliberately)', () => {
  it('grants any member when the widget exists in the org', async () => {
    // Matches the tRPC sibling `getChatWidgetIntegration`, a bare
    // `protectedProcedure`; these assets are `fileVisibility: PUBLIC` because
    // the logo renders on the public widget.
    queueRows(attachmentRow('CHAT_WIDGET', WIDGET_ID), [{ id: WIDGET_ID }])
    await expect(canView()).resolves.toBe(true)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('denies a widget id from another org', async () => {
    queueRows(attachmentRow('CHAT_WIDGET', WIDGET_ID), [])
    await expect(canView()).resolves.toBe(false)
    expect(fromTables).toEqual(['Attachment.id', 'ChatWidget.id'])
  })
})

describe('canViewAttachment — WORKFLOW_RUN', () => {
  it('grants a member holding `workflows: Read` on the run parent app', async () => {
    queueRows(attachmentRow('WORKFLOW_RUN', RUN_ID))
    memberHolding({ [Area.workflows]: Level.Read })
    await expect(canView()).resolves.toBe(true)
    expect(assertWorkflowRunNotSystemOwned).toHaveBeenCalledWith(expect.anything(), {
      runId: RUN_ID,
      organizationId: ORG_ID,
      isSuperAdmin: false,
      allowSuperAdminRead: false,
    })
  })

  it('denies a member composing `workflows: None`', async () => {
    queueRows(attachmentRow('WORKFLOW_RUN', RUN_ID))
    memberHolding({ [Area.workflows]: Level.None })
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a system-owned run instead of throwing a 500', async () => {
    // The guard signals system ownership by THROWING, not by returning false.
    // An uncaught throw here would surface as a 500 on the download route —
    // and, worse, the arm would never reach its own capability check.
    queueRows(attachmentRow('WORKFLOW_RUN', RUN_ID))
    assertWorkflowRunNotSystemOwned.mockRejectedValue(new Error('System-owned run'))
    memberHolding({ [Area.workflows]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('denies a run that does not exist in this org (guard returns undefined)', async () => {
    queueRows(attachmentRow('WORKFLOW_RUN', RUN_ID))
    assertWorkflowRunNotSystemOwned.mockResolvedValue(undefined)
    memberHolding({ [Area.workflows]: Level.Full })
    await expect(canView()).resolves.toBe(false)
    expect(getCapabilities).not.toHaveBeenCalled()
  })

  it('gates on the parent WorkflowApp id the guard returns, not the run id', async () => {
    // Instance access keys on `WorkflowApp.id`; an explicit `none` row there
    // must deny even at `workflows: Full`.
    queueRows(attachmentRow('WORKFLOW_RUN', RUN_ID))
    memberHolding(
      { [Area.workflows]: Level.Full },
      { instances: { [WORKFLOW_APP_ID]: ResourcePermission.none } }
    )
    await expect(canView()).resolves.toBe(false)
  })
})

describe('canViewAttachment — visit_qc_item', () => {
  it('grants a `dispatchBoardManage` holder with zero parent queries', async () => {
    // The office/dispatcher short-circuit: the board capability sees the whole
    // board, so the visit lookup is a cost only a field seat should pay.
    queueRows(attachmentRow('visit_qc_item', QC_ITEM_ID))
    memberHolding({ [Area.dispatchBoard]: Level.Full })
    await expect(canView()).resolves.toBe(true)
    expect(select).toHaveBeenCalledTimes(1)
    expect(fromTables).toEqual(['Attachment.id'])
    expect(loadOwnVisit).not.toHaveBeenCalled()
  })

  it('grants a non-holder whose own visit resolves', async () => {
    queueRows(attachmentRow('visit_qc_item', QC_ITEM_ID), [{ visitId: VISIT_ID }])
    memberHolding({ [Area.dispatchBoard]: Level.Read })
    await expect(canView()).resolves.toBe(true)
    expect(fromTables).toEqual(['Attachment.id', 'VisitQcItem.id'])
    expect(loadOwnVisit).toHaveBeenCalledWith(ORG_ID, USER_ID, VISIT_ID)
  })

  it('denies a non-holder whose visit lookup throws (not assigned to them)', async () => {
    // `loadOwnVisit` throws Forbidden/NotFound rather than returning a boolean.
    queueRows(attachmentRow('visit_qc_item', QC_ITEM_ID), [{ visitId: VISIT_ID }])
    loadOwnVisit.mockRejectedValue(new Error('This visit is not assigned to you'))
    memberHolding({ [Area.dispatchBoard]: Level.Read })
    await expect(canView()).resolves.toBe(false)
  })

  it('denies a non-holder when the QC item does not resolve in this org', async () => {
    queueRows(attachmentRow('visit_qc_item', QC_ITEM_ID), [])
    memberHolding({ [Area.dispatchBoard]: Level.Read })
    await expect(canView()).resolves.toBe(false)
    expect(loadOwnVisit).not.toHaveBeenCalled()
  })

  it('denies a member with no dispatch access at all', async () => {
    queueRows(attachmentRow('visit_qc_item', QC_ITEM_ID), [{ visitId: VISIT_ID }])
    loadOwnVisit.mockRejectedValue(new Error('This visit is not assigned to you'))
    memberHolding({})
    await expect(canView()).resolves.toBe(false)
  })
})

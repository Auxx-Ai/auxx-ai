// apps/web/src/server/api/routers/calls-tasks-permissions.test.ts

/**
 * plans/accounting/tasks/12-accountant-permissions.md §10 — calls, tasks and
 * kopilot each gained their own Layer-2 area. Calls and tasks had no area at
 * all (the sidebar showed them on a feature flag alone and the routers were
 * `protectedProcedure`, except `recording.delete` which rode `channelsManage`);
 * kopilot's procedures were `protectedProcedure` gated only by the org's
 * `kopilot` feature flag, with no per-member capability.
 *
 * Modelled on `comment-permissions.test.ts` / `ledger-permissions.test.ts`: a
 * real `CapabilitySet` built from `expandLevelsToKeys`, driven through
 * `router.createCaller`, asserting the `ForbiddenError` shape
 * `auxxErrorMiddleware` maps to a 403. "Admits" means the lib/service double
 * resolves and the caller does not throw — not a mock-call-count check.
 */

import { Area, expandLevelsToKeys, Level } from '@auxx/lib/permissions/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORG_ID = 'org_cuid000000000000000000000'
const USER_ID = 'usr_cuid000000000000000000000'

const okResult = <T>(value: T) => ({
  isErr: () => false as const,
  isOk: () => true as const,
  value,
})

// ─────────────────────────────────────────────────────────────────────────────
// Doubles — one function per lib/service call an "admit" case actually reaches.
// A "refuse" case never gets this far: the permission assert throws inside the
// middleware chain, before the resolver body runs.
// ─────────────────────────────────────────────────────────────────────────────

const { taskService, kopilotService } = vi.hoisted(() => ({
  taskService: {
    listTasks: vi.fn(async () => ({ tasks: [], nextCursor: null })),
    createTask: vi.fn(async () => ({ id: 'tsk_cuid00000000000000000000' })),
    getTaskById: vi.fn(),
    getTasksByIds: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    getGroupedTasks: vi.fn(),
    getTaskStats: vi.fn(),
  },
  kopilotService: {
    findSessionsByType: vi.fn(async () => ({
      isErr: () => false as const,
      value: { items: [], nextCursor: null },
    })),
    getSessionById: vi.fn(),
    deleteSession: vi.fn(),
    updateSessionTitle: vi.fn(),
    getSessionFeedback: vi.fn(),
    upsertMessageFeedback: vi.fn(),
  },
}))

vi.mock('@auxx/lib/recording', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@auxx/lib/recording')
  return {
    ...actual,
    listRecordings: vi.fn(async () => ({ recordings: [], nextCursor: null })),
    deleteRecording: vi.fn(async () => okResult(undefined)),
  }
})

vi.mock('@auxx/lib/tasks', () => ({
  createTaskService: () => taskService,
}))

vi.mock('@auxx/services', () => kopilotService)

vi.mock('@auxx/lib/permissions', async () => {
  const { PermissionKey } = await import('@auxx/lib/permissions/capabilities/registry')
  const { FeatureKey } = await import('@auxx/lib/permissions/types')
  return {
    PermissionKey,
    FeatureKey,
    // `kopilot.*` bodies still call `requireKopilotAccess` directly (the
    // org-level feature plan-AND, orthogonal to the per-member capability
    // this file is pinning) — always allow it here.
    FeaturePermissionService: class {
      async requireAccess() {
        return
      }
    },
  }
})

vi.mock('@auxx/logger', async () => (await import('~/test/logger-mock')).mockAuxxLogger())

vi.mock('~/server/api/trpc', async () => {
  const { initTRPC } = await import('@trpc/server')
  const t = initTRPC.context<Record<string, unknown>>().create()
  return {
    createTRPCRouter: t.router,
    protectedProcedure: t.procedure,
    permissionProcedure: (key: string) =>
      t.procedure.use(({ ctx, next }) => {
        ;(ctx as { capabilities: { assert: (permission: string) => void } }).capabilities.assert(
          key
        )
        return next()
      }),
    isAuxxError: (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in (error as Record<string, unknown>),
  }
})

const { CapabilitySet } = await import('@auxx/lib/permissions/capabilities/capability-set')
const { recordingRouter } = await import('./recording')
const { taskRouter } = await import('./task')
const { kopilotRouter } = await import('./kopilot')

type Capabilities = InstanceType<typeof CapabilitySet>

function capabilitiesFor(levels: Partial<Record<Area, Level>>): Capabilities {
  return new CapabilitySet(new Set(expandLevelsToKeys(levels)), {}, 'MEMBER', 'full')
}

const db = { marker: 'calls-tasks-permissions-db' }

const SESSION = {
  organizationId: ORG_ID,
  userId: USER_ID,
  user: { id: USER_ID, defaultOrganizationId: ORG_ID, isAdmin: false },
  isSuperAdmin: false,
}

function recordingCaller(capabilities: Capabilities) {
  return recordingRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

function taskCaller(capabilities: Capabilities) {
  return taskRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

function kopilotCaller(capabilities: Capabilities) {
  return kopilotRouter.createCaller({
    capabilities,
    db,
    headers: new Headers(),
    session: SESSION,
  } as never)
}

const FORBIDDEN = { cause: { name: 'ForbiddenError', statusCode: 403 } }

const noKeys = () => capabilitiesFor({})
const callsView = () => capabilitiesFor({ [Area.calls]: Level.Read })
const callsManage = () => capabilitiesFor({ [Area.calls]: Level.Full })
const tasksView = () => capabilitiesFor({ [Area.tasks]: Level.Read })
const tasksManage = () => capabilitiesFor({ [Area.tasks]: Level.Full })
const agentsView = () => capabilitiesFor({ [Area.agents]: Level.Read })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recording.list', () => {
  it('refuses a caller with no calls keys', async () => {
    await expect(recordingCaller(noKeys()).list({ limit: 20 })).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits calls.view', async () => {
    await expect(recordingCaller(callsView()).list({ limit: 20 })).resolves.toBeDefined()
  })
})

describe('recording.delete', () => {
  it('refuses calls.view', async () => {
    await expect(
      recordingCaller(callsView()).delete({ id: 'rec_cuid00000000000000000000' })
    ).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits calls.manage', async () => {
    await expect(
      recordingCaller(callsManage()).delete({ id: 'rec_cuid00000000000000000000' })
    ).resolves.toBeUndefined()
  })
})

describe('task.list', () => {
  it('refuses a caller with no tasks keys', async () => {
    await expect(taskCaller(noKeys()).list({ limit: 50 })).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits tasks.view', async () => {
    await expect(taskCaller(tasksView()).list({ limit: 50 })).resolves.toBeDefined()
  })
})

describe('task.create', () => {
  it('refuses tasks.view', async () => {
    await expect(taskCaller(tasksView()).create({ title: 'Follow up' })).rejects.toMatchObject(
      FORBIDDEN
    )
  })

  it('admits tasks.manage', async () => {
    await expect(taskCaller(tasksManage()).create({ title: 'Follow up' })).resolves.toBeDefined()
  })
})

describe('kopilot.listSessions', () => {
  it('refuses a caller with no agents keys', async () => {
    await expect(kopilotCaller(noKeys()).listSessions({})).rejects.toMatchObject(FORBIDDEN)
  })

  it('admits agents.view', async () => {
    await expect(kopilotCaller(agentsView()).listSessions({})).resolves.toBeDefined()
  })
})

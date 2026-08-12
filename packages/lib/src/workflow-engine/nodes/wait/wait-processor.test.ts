// packages/lib/src/workflow-engine/nodes/wait/wait-processor.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// The long-delay path schedules a BullMQ resume job. Capture it instead of connecting.
const queueAdd = vi.fn()
vi.mock('../../../jobs/queues', () => ({
  Queues: { workflowDelayQueue: 'workflowDelayQueue' },
  getQueue: () => ({ add: queueAdd }),
}))

import { WaitNodeProcessor } from './wait-processor'

/** Every path the builder's `getWaitOutputVariables` advertises for a wait node. */
const ADVERTISED_OUTPUTS = ['wait_duration_ms', 'wait_method', 'paused_at', 'resume_at'] as const

const waitNode = (data: Record<string, unknown>): WorkflowNode => ({
  id: 'wait-1',
  workflowId: 'workflow-1',
  nodeId: 'wait-1',
  type: WorkflowNodeType.WAIT,
  name: 'Test Wait',
  data: { id: 'wait-1', type: WorkflowNodeType.WAIT, title: 'Wait', ...data } as any,
})

describe('WaitNodeProcessor', () => {
  let processor: WaitNodeProcessor
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    queueAdd.mockClear()
    processor = new WaitNodeProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('output variables — short delay', () => {
    it('publishes every advertised output as a node variable', async () => {
      vi.useFakeTimers()
      const node = waitNode({
        waitType: 'duration',
        durationAmount: 2,
        durationUnit: 'seconds',
        isDurationConstant: true,
      })

      const running = processor.execute(node, contextManager)
      await vi.advanceTimersByTimeAsync(2000)
      const result = await running

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.wait_method).toBe('short_delay')

      for (const path of ADVERTISED_OUTPUTS) {
        expect(await contextManager.getVariable(`wait-1.${path}`)).toBe(result.output[path])
      }

      expect(await contextManager.getVariable('wait-1.wait_duration_ms')).toBe(2000)
      expect(await contextManager.getVariable('wait-1.wait_method')).toBe('short_delay')

      // resume_at is paused_at plus the wait — both real ISO timestamps, not undefined
      const pausedAt = new Date(await contextManager.getVariable('wait-1.paused_at'))
      const resumeAt = new Date(await contextManager.getVariable('wait-1.resume_at'))
      expect(Number.isNaN(pausedAt.getTime())).toBe(false)
      expect(resumeAt.getTime() - pausedAt.getTime()).toBe(2000)
    })

    /**
     * The legacy seconds-valued `duration` field is gone: the panel has only ever written
     * `durationAmount` + `durationUnit`, and no server-side author (including
     * `buildSequenceGraph`) writes `duration` either. A node carrying only it is now an
     * invalid config rather than a silently-honoured wait.
     */
    it('rejects a config that carries only the removed `duration` field', async () => {
      await expect(processor.execute(waitNode({ duration: 3 }), contextManager)).rejects.toThrow(
        'Wait type is required'
      )
    })

    it('rejects a duration variable that does not resolve to a number', async () => {
      await expect(
        processor.execute(
          waitNode({
            waitType: 'duration',
            durationAmount: '{{nope.missing}}',
            durationUnit: 'seconds',
            isDurationConstant: false,
          }),
          contextManager
        )
      ).rejects.toThrow('Wait duration did not resolve to a number')
    })
  })

  describe('output variables — long delay', () => {
    it('publishes every advertised output when the wait is queued', async () => {
      const node = waitNode({
        waitType: 'duration',
        durationAmount: 30,
        durationUnit: 'minutes',
        isDurationConstant: true,
      })

      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Paused)
      expect(queueAdd).toHaveBeenCalledTimes(1)

      for (const path of ADVERTISED_OUTPUTS) {
        expect(await contextManager.getVariable(`wait-1.${path}`)).toBe(result.output[path])
      }
      expect(await contextManager.getVariable('wait-1.wait_method')).toBe('queue_delay')
      expect(await contextManager.getVariable('wait-1.wait_duration_ms')).toBe(30 * 60 * 1000)
    })
  })

  /**
   * `deliveryWindow` and `anchor` are written by ONE author — `buildSequenceGraph` in
   * `packages/lib/src/sequences/publish.ts`. The builder panel neither writes nor reads them,
   * by design. These assert the shape that compiler actually emits stays executable.
   */
  describe('server-authored sequence config', () => {
    it('accepts the zero-duration + deliveryWindow wait that step 1 compiles to', async () => {
      const preprocessed = await processor.preprocessNode(
        waitNode({
          waitType: 'duration',
          durationAmount: 0,
          isDurationConstant: true,
          durationUnit: 'seconds',
          deliveryWindow: {
            startTime: '08:00',
            endTime: '20:00',
            timezone: 'UTC',
            businessDaysOnly: false,
          },
        }),
        contextManager
      )

      expect(preprocessed.inputs.durationConfig.duration).toBe(0)
    })

    it('accepts the zero-duration + anchor wait an anchor step compiles to', async () => {
      const preprocessed = await processor.preprocessNode(
        waitNode({
          waitType: 'duration',
          durationAmount: 0,
          isDurationConstant: true,
          durationUnit: 'seconds',
          anchor: {
            subjectRef: 'visit',
            offsetDays: -1,
            timeOfDay: '09:00',
            timezone: 'UTC',
          },
        }),
        contextManager
      )

      expect(preprocessed.inputs.durationConfig.duration).toBe(0)
    })

    it('still rejects a zero duration with neither window nor anchor', async () => {
      await expect(
        processor.preprocessNode(
          waitNode({
            waitType: 'duration',
            durationAmount: 0,
            isDurationConstant: true,
            durationUnit: 'seconds',
          }),
          contextManager
        )
      ).rejects.toThrow('Wait duration must be between 1ms and maximum allowed duration')
    })
  })

  describe('timezone', () => {
    /**
     * The builder's timezone picker writes `data.timezone`. Before this it was inert —
     * the engine parsed the wall-clock string in the SERVER's zone.
     */
    it('reads the target time as wall-clock time in the configured timezone', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      const node = waitNode({
        waitType: 'specific_time',
        time: '2030-06-01T09:00',
        isTimeConstant: true,
        timezone: 'America/New_York',
      })

      const result = await processor.execute(node, contextManager)

      // 09:00 EDT === 13:00 UTC
      expect(result.output.resume_at).toBe('2030-06-01T13:00:00.000Z')
      expect(await contextManager.getVariable('wait-1.resume_at')).toBe('2030-06-01T13:00:00.000Z')
    })

    it('resolves the same wall-clock time differently per timezone', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      const berlin = await processor.execute(
        waitNode({
          waitType: 'specific_time',
          time: '2030-06-01T09:00',
          isTimeConstant: true,
          timezone: 'Europe/Berlin',
        }),
        contextManager
      )

      expect(berlin.output.resume_at).toBe('2030-06-01T07:00:00.000Z')
    })

    it('does not re-shift a target time that already carries an offset', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      const result = await processor.execute(
        waitNode({
          waitType: 'specific_time',
          time: '2030-06-01T09:00:00Z',
          isTimeConstant: true,
          timezone: 'America/New_York',
        }),
        contextManager
      )

      expect(result.output.resume_at).toBe('2030-06-01T09:00:00.000Z')
    })

    it('falls back to server-local parsing when no timezone is configured', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      const result = await processor.execute(
        waitNode({
          waitType: 'specific_time',
          time: '2030-06-01T09:00',
          isTimeConstant: true,
        }),
        contextManager
      )

      expect(result.output.resume_at).toBe(new Date('2030-06-01T09:00').toISOString())
    })

    it('rejects an unknown timezone instead of silently using the server zone', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      await expect(
        processor.execute(
          waitNode({
            waitType: 'specific_time',
            time: '2030-06-01T09:00',
            isTimeConstant: true,
            timezone: 'Not/AZone',
          }),
          contextManager
        )
      ).rejects.toThrow('Unknown timezone "Not/AZone" on wait node')
    })

    it('applies the timezone in preprocessNode as well', async () => {
      vi.setSystemTime(new Date('2030-05-01T00:00:00Z'))
      const preprocessed = await processor.preprocessNode(
        waitNode({
          waitType: 'specific_time',
          time: '2030-06-01T09:00',
          isTimeConstant: true,
          timezone: 'America/New_York',
        }),
        contextManager
      )

      expect(preprocessed.inputs.timestampConfig.targetTime).toBe('2030-06-01T13:00:00.000Z')
    })
  })
})

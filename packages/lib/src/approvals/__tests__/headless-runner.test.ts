// packages/lib/src/approvals/__tests__/headless-runner.test.ts

import { describe, expect, it } from 'vitest'
import type { CapturedAction } from '../../ai/agent-framework/types'
import { sanitizeEventPayloadForLLM } from '../sanitize-event-payload'
import type { ProposedAction } from '../types'
import { mergeActions, parseFinalText } from '../utils'

describe('sanitizeEventPayloadForLLM', () => {
  it('passes through low-cardinality field values verbatim', () => {
    const payload = {
      fieldName: 'stage',
      fieldType: 'SINGLE_SELECT',
      oldValue: 'New',
      newValue: 'Qualified',
    }
    expect(sanitizeEventPayloadForLLM(payload)).toEqual(payload)
  })

  it('truncates free-text field values to 150 chars', () => {
    const longPii = 'a'.repeat(500)
    const sanitized = sanitizeEventPayloadForLLM({
      fieldName: 'customer_notes',
      fieldType: 'TEXT',
      oldValue: longPii,
      newValue: longPii,
    })
    expect(sanitized).toBeDefined()
    const oldValue = sanitized?.oldValue as string
    const newValue = sanitized?.newValue as string
    expect(oldValue.length).toBeLessThan(longPii.length)
    expect(oldValue).toMatch(/… \[truncated\]$/)
    expect(newValue).toMatch(/… \[truncated\]$/)
  })

  it('truncates RICH_TEXT, EMAIL, PHONE_INTL, URL, NAME, ADDRESS_STRUCT free-text values', () => {
    const long = 'x'.repeat(300)
    for (const fieldType of ['RICH_TEXT', 'EMAIL', 'PHONE_INTL', 'URL', 'NAME', 'ADDRESS_STRUCT']) {
      const sanitized = sanitizeEventPayloadForLLM({
        fieldName: 'f',
        fieldType,
        newValue: long,
      })
      expect((sanitized?.newValue as string).length).toBeLessThan(long.length)
    }
  })

  it('truncates `snippet` and `content` keys regardless of field type', () => {
    const long = 'y'.repeat(300)
    const sanitized = sanitizeEventPayloadForLLM({
      messageId: 'm1',
      from: 'a@b.co',
      snippet: long,
      content: long,
    })
    expect((sanitized?.snippet as string).length).toBeLessThan(long.length)
    expect((sanitized?.content as string).length).toBeLessThan(long.length)
  })

  it('returns undefined / non-objects unchanged', () => {
    expect(sanitizeEventPayloadForLLM(undefined)).toBeUndefined()
  })

  it('does not truncate short values even if free-text', () => {
    const sanitized = sanitizeEventPayloadForLLM({
      fieldName: 'name',
      fieldType: 'TEXT',
      newValue: 'Acme Corp',
    })
    expect(sanitized?.newValue).toBe('Acme Corp')
  })
})

describe('parseFinalText', () => {
  it('extracts [summary] line', () => {
    const text = 'Some context.\n[summary] follow up with customer'
    expect(parseFinalText(text)).toEqual({ summary: 'follow up with customer' })
  })

  it('extracts [noop] line', () => {
    const text = '[noop] customer already replied two hours ago'
    expect(parseFinalText(text)).toEqual({ noopReason: 'customer already replied two hours ago' })
  })

  it('falls back to first 60 chars when no marker is present', () => {
    const text = 'plain assistant text without markers, lorem ipsum dolor sit amet'
    const parsed = parseFinalText(text)
    expect(parsed.summary).toBeDefined()
    expect(parsed.summary?.length).toBeLessThanOrEqual(60)
  })

  it('returns empty when text is empty', () => {
    expect(parseFinalText('')).toEqual({})
  })
})

describe('mergeActions', () => {
  it('preserves captured actions verbatim and appends soft actions with renumbered indices', () => {
    const captured: CapturedAction[] = [
      {
        toolCallId: 'c1',
        toolName: 'create_task',
        args: { title: 'follow up' },
        summary: 'Create task: "follow up"',
        localIndex: 0,
        predictedOutput: { _captured: true, taskId: 'temp_0', title: 'follow up' },
      },
      {
        toolCallId: 'c2',
        toolName: 'create_task',
        args: { title: 'send recap' },
        summary: 'Create task: "send recap"',
        localIndex: 1,
        predictedOutput: { _captured: true, taskId: 'temp_1' },
      },
    ]
    const soft: ProposedAction[] = [
      {
        localIndex: -1,
        toolName: 'reply_to_thread',
        args: { threadId: 't1', body: 'hi' },
        summary: 'Reply: "hi"',
        ranDuringCapture: { output: { draftId: 'd1', body: 'hi' } },
      },
    ]
    const merged = mergeActions(soft, captured)
    expect(merged).toHaveLength(3)
    expect(merged[0]?.localIndex).toBe(0)
    expect(merged[0]?.toolName).toBe('create_task')
    expect(merged[1]?.localIndex).toBe(1)
    expect(merged[2]?.localIndex).toBe(2)
    expect(merged[2]?.toolName).toBe('reply_to_thread')
    expect(merged[2]?.ranDuringCapture?.output).toEqual({ draftId: 'd1', body: 'hi' })
  })

  it('renumbers soft actions starting after the highest captured localIndex', () => {
    const captured: CapturedAction[] = [
      {
        toolCallId: 'c1',
        toolName: 'spawn_work_item',
        args: {},
        summary: 's',
        localIndex: 5,
        predictedOutput: { _captured: true, entityInstanceId: 'temp_5' },
      },
    ]
    const soft: ProposedAction[] = [
      {
        localIndex: -1,
        toolName: 'reply_to_thread',
        args: {},
        summary: 's',
        ranDuringCapture: { output: {} },
      },
    ]
    const merged = mergeActions(soft, captured)
    expect(merged[1]?.localIndex).toBe(6)
  })

  it('handles empty inputs', () => {
    expect(mergeActions([], [])).toEqual([])
  })

  it('produces only soft actions when no captures exist', () => {
    const soft: ProposedAction[] = [
      {
        localIndex: -1,
        toolName: 'reply_to_thread',
        args: {},
        summary: 's',
        ranDuringCapture: { output: {} },
      },
    ]
    const merged = mergeActions(soft, [])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.localIndex).toBe(0)
  })

  it('passes captured predictedOutput onto ProposedAction.predictedOutput', () => {
    const captured: CapturedAction[] = [
      {
        toolCallId: 'c1',
        toolName: 'create_task',
        args: {},
        summary: 's',
        localIndex: 0,
        predictedOutput: { _captured: true, taskId: 'temp_0' },
      },
    ]
    const merged = mergeActions([], captured)
    expect(merged[0]?.predictedOutput).toEqual({ _captured: true, taskId: 'temp_0' })
  })
})

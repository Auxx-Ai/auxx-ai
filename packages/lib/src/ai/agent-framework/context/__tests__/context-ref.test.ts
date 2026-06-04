// packages/lib/src/ai/agent-framework/context/__tests__/context-ref.test.ts

import type { FieldPath, ResourceFieldId } from '@auxx/types/field'
import { describe, expect, it } from 'vitest'
import { parseContextRef } from '../context-ref'

describe('parseContextRef', () => {
  describe('var:', () => {
    it('parses a bare var as root with empty path', () => {
      expect(parseContextRef('var:plan')).toEqual({ kind: 'var', root: 'plan', path: '' })
    })

    it('splits nested dotted paths at the first dot', () => {
      expect(parseContextRef('var:cart.total')).toEqual({
        kind: 'var',
        root: 'cart',
        path: 'total',
      })
      expect(parseContextRef('var:a.b.c')).toEqual({ kind: 'var', root: 'a', path: 'b.c' })
    })

    it('keeps bracket navigation attached to the path', () => {
      expect(parseContextRef('var:items[0]')).toEqual({ kind: 'var', root: 'items', path: '[0]' })
      expect(parseContextRef('var:items[*].id')).toEqual({
        kind: 'var',
        root: 'items',
        path: '[*].id',
      })
    })
  })

  describe('sys:', () => {
    it('parses the system key', () => {
      expect(parseContextRef('sys:userId')).toEqual({ kind: 'sys', key: 'userId' })
      expect(parseContextRef('sys:now')).toEqual({ kind: 'sys', key: 'now' })
      expect(parseContextRef('sys:agentName')).toEqual({ kind: 'sys', key: 'agentName' })
    })
  })

  describe('call:', () => {
    it('parses the toolCallId and trailing path', () => {
      expect(parseContextRef('call:abc123')).toEqual({
        kind: 'call',
        toolCallId: 'abc123',
        path: '',
      })
      expect(parseContextRef('call:abc123.orders[0].id')).toEqual({
        kind: 'call',
        toolCallId: 'abc123',
        path: 'orders[0].id',
      })
    })
  })

  describe('tool:', () => {
    it('latest view (no selector)', () => {
      expect(parseContextRef('tool:get_order_info')).toEqual({
        kind: 'tool',
        name: 'get_order_info',
        all: false,
        index: undefined,
        path: '',
      })
    })

    it('all view via [] and [*]', () => {
      expect(parseContextRef('tool:get_order_info[]')).toMatchObject({
        kind: 'tool',
        name: 'get_order_info',
        all: true,
        path: '',
      })
      expect(parseContextRef('tool:get_order_info[*]')).toMatchObject({
        name: 'get_order_info',
        all: true,
        path: '',
      })
    })

    it('indexed view', () => {
      expect(parseContextRef('tool:get_order_info[0]')).toMatchObject({
        kind: 'tool',
        name: 'get_order_info',
        all: false,
        index: 0,
        path: '',
      })
    })

    it('indexed view with a trailing path', () => {
      expect(parseContextRef('tool:get_order_info[0].email')).toMatchObject({
        name: 'get_order_info',
        index: 0,
        path: 'email',
      })
    })

    it('latest view with a deep navigation path (bracket is not a selector)', () => {
      expect(parseContextRef('tool:get_order_info.orders[*].id')).toMatchObject({
        name: 'get_order_info',
        all: false,
        index: undefined,
        path: 'orders[*].id',
      })
    })
  })

  describe('FieldReference (non-reserved prefix)', () => {
    it('treats a system field ref as a field, whole string preserved', () => {
      expect(parseContextRef('contact:primary_email' as ResourceFieldId)).toEqual({
        kind: 'field',
        ref: 'contact:primary_email',
      })
    })

    it('keeps the @app: late-bound colons intact', () => {
      expect(parseContextRef('contact:@app:shopify:customerId' as ResourceFieldId)).toEqual({
        kind: 'field',
        ref: 'contact:@app:shopify:customerId',
      })
    })

    it('treats the array form as a FieldPath', () => {
      const path = ['contact:company', 'company:name'] as FieldPath
      expect(parseContextRef(path)).toEqual({ kind: 'field', ref: path })
    })

    it('a bare slug with no colon is a field', () => {
      expect(parseContextRef('email' as ResourceFieldId)).toEqual({ kind: 'field', ref: 'email' })
    })
  })
})

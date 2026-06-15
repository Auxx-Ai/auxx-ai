// packages/lib/src/workflows/templates/__tests__/file-templates.test.ts
// Structural validation of bundled file templates. Runs in CI to catch the kind
// of drift that motivated read-time templates (blank AI prompts, dangling edges,
// undeclared app slugs) before a template can ship.

import { describe, expect, it } from 'vitest'
import { normalizeTemplateGraph } from '../../normalize-template-graph'
import { FILE_TEMPLATES, getFileTemplateById, isFileTemplateId } from '../index'

/** A Tiptap doc is `{ type: 'doc', content: [...] }`. */
function isTiptapDoc(json: unknown): boolean {
  return !!json && typeof json === 'object' && (json as { type?: unknown }).type === 'doc'
}

describe('file template registry', () => {
  it('has at least one template', () => {
    expect(FILE_TEMPLATES.length).toBeGreaterThan(0)
  })

  it('has unique, file-prefixed ids', () => {
    const ids = FILE_TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(isFileTemplateId(id)).toBe(true)
    }
  })

  it('resolves each template by id', () => {
    for (const t of FILE_TEMPLATES) {
      expect(getFileTemplateById(t.id)?.id).toBe(t.id)
    }
  })
})

describe.each(FILE_TEMPLATES.map((t) => [t.name, t] as const))('file template: %s', (_name, t) => {
  it('has required metadata', () => {
    expect(t.name.trim()).not.toBe('')
    expect(t.description.trim()).not.toBe('')
    expect(['public', 'private']).toContain(t.status)
  })

  it('has a well-formed graph', () => {
    expect(Array.isArray(t.graph?.nodes)).toBe(true)
    expect(Array.isArray(t.graph?.edges)).toBe(true)
  })

  it('has unique node ids', () => {
    const ids = t.graph.nodes.map((n: { id: string }) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('only has edges that reference existing nodes', () => {
    const nodeIds = new Set(t.graph.nodes.map((n: { id: string }) => n.id))
    for (const edge of t.graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
  })

  it('has valid AI-node prompts (normalized {role, json} docs)', () => {
    const aiNodes = t.graph.nodes.filter((n: { data?: { type?: string } }) => n.data?.type === 'ai')
    for (const node of aiNodes) {
      const prompts = node.data.prompt_template
      expect(Array.isArray(prompts)).toBe(true)
      for (const entry of prompts) {
        expect(typeof entry.role).toBe('string')
        expect(isTiptapDoc(entry.json)).toBe(true)
      }
    }
  })

  it('declares every app slug used by app nodes in requiredApps', () => {
    const declared = new Set(t.requiredApps.map((a) => a.appSlug))
    const used = new Set<string>()
    for (const node of t.graph.nodes) {
      const slug = (node as { data?: { appSlug?: string } }).data?.appSlug
      if (slug) used.add(slug)
    }
    for (const slug of used) {
      expect(declared.has(slug)).toBe(true)
    }
  })
})

describe('normalizeTemplateGraph', () => {
  it('converts legacy {role, text} prompts to {role, json} Tiptap docs', () => {
    const graph = {
      nodes: [
        {
          id: 'ai_1',
          data: {
            id: 'ai_1',
            type: 'ai',
            prompt_template: [{ role: 'system', text: 'Hello {{trigger_1.message.body}}' }],
          },
        },
      ],
      edges: [],
    }
    const result = normalizeTemplateGraph(graph)
    const entry = result.nodes[0].data.prompt_template[0]
    expect(entry.role).toBe('system')
    expect(isTiptapDoc(entry.json)).toBe(true)
    // The {{variable}} becomes an inline variable-node chip.
    const serialized = JSON.stringify(entry.json)
    expect(serialized).toContain('variable-node')
    expect(serialized).toContain('trigger_1.message.body')
  })

  it('leaves existing json prompts untouched', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph' }] }
    const graph = {
      nodes: [
        {
          id: 'ai_1',
          data: { id: 'ai_1', type: 'ai', prompt_template: [{ role: 'user', json: doc }] },
        },
      ],
      edges: [],
    }
    const result = normalizeTemplateGraph(graph)
    expect(result.nodes[0].data.prompt_template[0].json).toEqual(doc)
  })

  it('ignores non-ai nodes', () => {
    const graph = {
      nodes: [{ id: 'answer_1', data: { id: 'answer_1', type: 'answer', text: '{{ai_1.text}}' } }],
      edges: [],
    }
    const result = normalizeTemplateGraph(graph)
    expect(result.nodes[0].data.text).toBe('{{ai_1.text}}')
  })

  it('does not mutate the input graph', () => {
    const graph = {
      nodes: [
        {
          id: 'ai_1',
          data: { id: 'ai_1', type: 'ai', prompt_template: [{ role: 'system', text: 'hi' }] },
        },
      ],
      edges: [],
    }
    normalizeTemplateGraph(graph)
    expect(graph.nodes[0].data.prompt_template[0]).toEqual({ role: 'system', text: 'hi' })
  })
})

// apps/web/src/components/workflow/ui/code-editor/__tests__/workflow-completions.test.ts

import {
  transformWorkflowVariableSyntax,
  extractVariableReferences,
} from '../monaco-workflow-completions'

describe('Workflow Variable Syntax', () => {
  describe('transformWorkflowVariableSyntax', () => {
    it('should transform $() syntax to {{}} format', () => {
      const input = `const data = $('node-123').var('content');`
      const expected = `const data = {{node-123.content}};`
      expect(transformWorkflowVariableSyntax(input)).toBe(expected)
    })

    it('should handle multiple variables', () => {
      const input = `
        const title = $('node-1').var('title');
        const body = $('node-2').var('body');
        const result = title + body;
      `
      const expected = `
        const title = {{node-1.title}};
        const body = {{node-2.body}};
        const result = title + body;
      `
      expect(transformWorkflowVariableSyntax(input)).toBe(expected)
    })

    it('should handle double quotes', () => {
      const input = `const data = $("node-123").var("content");`
      const expected = `const data = {{node-123.content}};`
      expect(transformWorkflowVariableSyntax(input)).toBe(expected)
    })

    it('should handle nested properties', () => {
      const input = `const email = $('node-123').var('user.email');`
      const expected = `const email = {{node-123.user.email}};`
      expect(transformWorkflowVariableSyntax(input)).toBe(expected)
    })
  })

  describe('extractVariableReferences', () => {
    it('should extract single variable reference', () => {
      const code = `const data = $('node-123').var('content');`
      const refs = extractVariableReferences(code)

      expect(refs).toHaveLength(1)
      expect(refs[0]).toEqual({
        nodeId: 'node-123',
        variablePath: 'content',
        fullPath: 'node-123.content',
      })
    })

    it('should extract multiple variable references', () => {
      const code = `
        const title = $('node-1').var('title');
        const body = $('node-2').var('body');
      `
      const refs = extractVariableReferences(code)

      expect(refs).toHaveLength(2)
      expect(refs[0]).toEqual({
        nodeId: 'node-1',
        variablePath: 'title',
        fullPath: 'node-1.title',
      })
      expect(refs[1]).toEqual({
        nodeId: 'node-2',
        variablePath: 'body',
        fullPath: 'node-2.body',
      })
    })

    it('should handle both quote types', () => {
      const code = `
        const a = $('node-1').var('var1');
        const b = $("node-2").var("var2");
      `
      const refs = extractVariableReferences(code)

      expect(refs).toHaveLength(2)
      expect(refs[0].nodeId).toBe('node-1')
      expect(refs[1].nodeId).toBe('node-2')
    })
  })
})

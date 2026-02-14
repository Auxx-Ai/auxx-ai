// packages/workflow-nodes/src/test/example.test.ts
import { describe, expect, it } from 'vitest'

describe('Example Workflow Nodes Test', () => {
  it('should perform basic assertions', () => {
    expect(true).toBe(true)
    expect('workflow').toMatch(/work/)
    expect({ id: '1', name: 'test' }).toHaveProperty('id')
  })

  it('should handle arrays', () => {
    const nodes = ['trigger', 'action', 'condition']

    expect(nodes).toHaveLength(3)
    expect(nodes).toContain('trigger')
    expect(nodes[0]).toBe('trigger')
  })

  it('should handle objects', () => {
    const nodeConfig = {
      id: 'test-node',
      type: 'action',
      config: {
        enabled: true,
        timeout: 30000,
      },
    }

    expect(nodeConfig).toHaveProperty('id', 'test-node')
    expect(nodeConfig.config.enabled).toBe(true)
    expect(nodeConfig.config.timeout).toBeGreaterThan(0)
  })
})

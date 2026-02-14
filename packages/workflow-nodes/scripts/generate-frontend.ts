#!/usr/bin/env tsx
// packages/workflow-nodes/scripts/generate-frontend.ts

import fs from 'fs-extra'
import { glob } from 'glob'
import path from 'path'
import { fileURLToPath } from 'url'
import { NodeFileGenerator } from '../src/generators/node-file-generator'
import { type UnifiedNodeConfig, validateNodeConfig } from '../src/types/unified-config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Build-time frontend code generator
 * Generates TypeScript files for workflow nodes from JSON configurations
 */
export class FrontendGenerator {
  private readonly configPattern = 'src/nodes/**/*.config.json'
  private readonly outputBaseDir = '../../../apps/web/src/components/workflow/nodes/application'

  async generateAll(): Promise<void> {
    console.log('🚀 Generating frontend code from node configurations...')

    const configFiles = await this.findConfigFiles()
    console.log(`📁 Found ${configFiles.length} configuration files`)

    const results = await Promise.allSettled(
      configFiles.map((configFile) => this.generateSingleNode(configFile))
    )

    const successful = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    console.log(`✅ Successfully generated ${successful} nodes`)
    if (failed > 0) {
      console.log(`❌ Failed to generate ${failed} nodes`)

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`   - ${configFiles[index]}: ${result.reason}`)
        }
      })
    }

    // Generate auto-registry file
    await this.generateAutoRegistry(configFiles)

    console.log('🎉 Frontend generation complete!')
  }

  async generateSingleNode(configPath: string): Promise<void> {
    try {
      // Load and validate configuration
      const config = await this.loadConfig(configPath)
      const errors = validateNodeConfig(config)

      if (errors.length > 0) {
        throw new Error(`Configuration validation failed:\n${errors.join('\n')}`)
      }

      // Generate files
      const generator = new NodeFileGenerator(config)
      const files = {
        'types.ts': generator.generateTypes(),
        'components.tsx': generator.generateComponents(),
        'node.tsx': generator.generateNodeComponent(),
        'schema.ts': generator.generateSchema(),
        'definition.ts': generator.generateDefinition(),
        'index.ts': generator.generateIndex(),
      }

      // Write files to output directory
      const outputDir = this.getOutputDir(config.node.id)
      await this.writeFiles(outputDir, files)

      console.log(`✨ Generated ${config.node.id} node`)
    } catch (error) {
      console.error(`❌ Failed to generate ${configPath}:`, error)
      throw error
    }
  }

  private async findConfigFiles(): Promise<string[]> {
    const cwd = path.resolve(__dirname, '..')
    return await glob(this.configPattern, { cwd })
  }

  private async loadConfig(configPath: string): Promise<UnifiedNodeConfig> {
    const fullPath = path.resolve(__dirname, '..', configPath)

    if (!(await fs.pathExists(fullPath))) {
      throw new Error(`Configuration file not found: ${configPath}`)
    }

    const content = await fs.readFile(fullPath, 'utf-8')

    try {
      return JSON.parse(content) as UnifiedNodeConfig
    } catch (error) {
      throw new Error(`Invalid JSON in ${configPath}: ${error}`)
    }
  }

  private getOutputDir(nodeId: string): string {
    return path.resolve(__dirname, this.outputBaseDir, nodeId)
  }

  private async writeFiles(outputDir: string, files: Record<string, string>): Promise<void> {
    // Ensure output directory exists
    await fs.ensureDir(outputDir)

    // Write all files
    await Promise.all(
      Object.entries(files).map(([filename, content]) =>
        fs.writeFile(path.join(outputDir, filename), content, 'utf-8')
      )
    )
  }

  /**
   * Generate auto-registry file for automatic node registration
   */
  private async generateAutoRegistry(configFiles: string[]): Promise<void> {
    const configs = await Promise.all(configFiles.map((configPath) => this.loadConfig(configPath)))

    const registryContent = this.generateRegistryContent(configs)
    const registryPath = path.resolve(__dirname, this.outputBaseDir, 'auto-generated-registry.ts')

    await fs.writeFile(registryPath, registryContent, 'utf-8')
    console.log(`📝 Generated auto-registry with ${configs.length} nodes`)
  }

  /**
   * Generate the content for auto-generated-registry.ts
   */
  private generateRegistryContent(configs: UnifiedNodeConfig[]): string {
    const imports = configs.map((config) => {
      const nodeId = config.node.id
      const capitalizedId = this.capitalize(nodeId)

      return {
        nodeComponent: `import { ${capitalizedId}Node } from './${nodeId}/node'`,
        definition: `import { ${nodeId}Definition } from './${nodeId}'`,
        nodeId,
        capitalizedId,
      }
    })

    const nodeComponentImports = imports.map((i) => i.nodeComponent).join('\n')
    const definitionImports = imports.map((i) => i.definition).join('\n')

    const definitionsArray = imports.map((i) => `  ${i.nodeId}Definition,`).join('\n')

    const nodeTypesObject = imports
      .map((i) => {
        // Map config nodeId to NodeType enum
        const nodeTypeKey = this.getNodeTypeKey(i.nodeId)
        return `  [NodeType.${nodeTypeKey}]: ${i.capitalizedId}Node as ComponentType<NodeProps>,`
      })
      .join('\n')

    return `// 🤖 AUTO-GENERATED by packages/workflow-nodes/scripts/generate-frontend.ts - DO NOT EDIT
// This file is automatically updated when running: pnpm --filter @auxx/workflow-nodes run generate

import { ComponentType } from 'react'
import { NodeProps } from '@xyflow/react'
import { NodeDefinition, NodeType } from '~/components/workflow/types'

// Generated node component imports
${nodeComponentImports}

// Generated node definition imports  
${definitionImports}

/**
 * Auto-generated node definitions
 * Updated automatically when running: pnpm --filter @auxx/workflow-nodes run generate
 */
export const AUTO_GENERATED_NODE_DEFINITIONS: NodeDefinition[] = [
${definitionsArray}
]

/**
 * Auto-generated node component types  
 * Updated automatically when running: pnpm --filter @auxx/workflow-nodes run generate
 */
export const AUTO_GENERATED_NODE_TYPES: Record<string, ComponentType<NodeProps>> = {
${nodeTypesObject}
}
`
  }

  /**
   * Map config node ID to NodeType enum key
   */
  private getNodeTypeKey(nodeId: string): string {
    // Handle specific mappings
    const mappings: Record<string, string> = {
      professionalNetwork: 'PROFESSIONAL_NETWORK',
      linkedin: 'PROFESSIONAL_NETWORK',
      // Add more mappings as needed
    }

    return mappings[nodeId] || nodeId.toUpperCase()
  }

  /**
   * Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Watch mode for development
   */
  async watch(): Promise<void> {
    console.log('👁️  Watching configuration files for changes...')

    // Initial generation
    await this.generateAll()

    // Setup watcher (simple polling for now)
    setInterval(async () => {
      try {
        await this.generateAll()
      } catch (error) {
        console.error('❌ Watch generation failed:', error)
      }
    }, 2000) // Check every 2 seconds in development
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2)
  const generator = new FrontendGenerator()

  if (args.includes('--watch')) {
    await generator.watch()
  } else {
    await generator.generateAll()
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Generation failed:', error)
    process.exit(1)
  })
}

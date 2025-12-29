// packages/workflow-nodes/src/nodes/linkedin/linkedin.node.ts

import type { INodeTypeBaseDescription, IVersionedNodeType } from '../../types'
import { VersionedNodeType } from '../../types'
import { ProfessionalNetworkV1 } from './v1/linkedin.v1.node'

/**
 * Professional Network Posting Node
 * Integrates with LinkedIn API for automated content publishing
 */
export class ProfessionalNetworkNode extends VersionedNodeType {
  constructor() {
    const baseDescription: INodeTypeBaseDescription = {
      displayName: 'Professional Network Poster',
      name: 'professionalNetworkPoster',
      icon: 'file:linkedin.svg',
      group: ['marketing'],
      description: 'Publish content to professional networking platforms for customer engagement',
      defaultVersion: 1.0,
    }

    const nodeVersions: IVersionedNodeType['nodeVersions'] = {
      1: new ProfessionalNetworkV1(baseDescription),
    }

    super(nodeVersions, baseDescription)
  }
}

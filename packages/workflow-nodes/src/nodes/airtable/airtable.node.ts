import type { INodeTypeBaseDescription, IVersionedNodeType } from '../../types'
import { VersionedNodeType } from '../../types'

// import { AirtableV2 } from './v1/airtable.v1.node'

export class Airtable extends VersionedNodeType {
  constructor() {
    const baseDescription: INodeTypeBaseDescription = {
      displayName: 'Airtable',
      name: 'airtable',
      icon: 'file:airtable.svg',
      group: ['input'],
      description: 'Read, update, write and delete data from Airtable',
      defaultVersion: 2.1,
    }

    const nodeVersions: IVersionedNodeType['nodeVersions'] = {
      // TODO: Implement AirtableV2 node
      // 2: new AirtableV2(baseDescription),
      // 2.1: new AirtableV2(baseDescription),
    }

    super(nodeVersions, baseDescription)
  }
}

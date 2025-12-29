import { Command } from 'commander'
import { versionCreate } from './create.js'
import { versionList } from './list.js'
export const version = new Command('version')
  .description('Manage app versions')
  .addCommand(versionCreate)
  .addCommand(versionList)

#!/usr/bin/env node
// packages/sdk/src/auxx.ts

import { Command } from 'commander'
import { apps } from './commands/apps.js'
import { build } from './commands/build.js'
import { dev } from './commands/dev.js'
import { init } from './commands/init.js'
import { login } from './commands/login.js'
import { logout } from './commands/logout.js'
import { logs } from './commands/logs.js'
import { version } from './commands/version/index.js'
import { whoami } from './commands/whoami.js'

const program = new Command()

program
  .name('auxx')
  .description('CLI tool to create Auxx apps')
  .version('0.0.1-experimental.1')
  .addCommand(init)
  .addCommand(apps)
  .addCommand(build)
  .addCommand(dev)
  .addCommand(version)
  .addCommand(login)
  .addCommand(logout)
  .addCommand(whoami)
  .addCommand(logs)
  .parse()

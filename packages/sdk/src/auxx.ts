#!/usr/bin/env node
// packages/sdk/src/auxx.ts

import './env-loader.js'

import { createRequire } from 'node:module'
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

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

const program = new Command()

program
  .name('auxx')
  .description('CLI tool to create Auxx apps')
  .version(pkg.version)
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

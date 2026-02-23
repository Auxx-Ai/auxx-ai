// scripts/check-db-env-drift.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path to this script file for stable workspace root resolution. */
const SCRIPT_FILENAME = fileURLToPath(import.meta.url)

/** Absolute path to the scripts directory. */
const SCRIPT_DIRNAME = path.dirname(SCRIPT_FILENAME)

/** Absolute path to the workspace root. */
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIRNAME, '..')

/** Root .env path used as the canonical local database source. */
const ROOT_ENV_PATH = path.join(WORKSPACE_ROOT, '.env')

/** Docker Compose file used to verify local database name alignment. */
const DOCKER_COMPOSE_PATH = path.join(WORKSPACE_ROOT, 'docker-compose.yml')

/** App env paths that should mirror the canonical root DATABASE_URL. */
const TARGET_ENV_PATHS = [
  path.join(WORKSPACE_ROOT, 'apps/api/.env'),
  path.join(WORKSPACE_ROOT, 'apps/build/.env'),
  path.join(WORKSPACE_ROOT, 'apps/kb/.env'),
  path.join(WORKSPACE_ROOT, 'apps/web/.env'),
  path.join(WORKSPACE_ROOT, 'apps/worker/.env'),
]

/** Default local database user when DATABASE_USER is not defined. */
const DEFAULT_DATABASE_USER = 'postgres'

/** Default local database host for non-self-hosted local development. */
const DEFAULT_DATABASE_HOST = 'localhost'

/** Default local database host for self-hosted compose mode. */
const SELF_HOSTED_DATABASE_HOST = 'postgres'

/** Default local database port when DATABASE_PORT is not defined. */
const DEFAULT_DATABASE_PORT = '5432'

/** Default local database name that matches docker-compose.yml. */
const DEFAULT_DATABASE_NAME = 'auxx-ai'

/** CLI flag that forces this check to fail when root .env is missing. */
const REQUIRE_ROOT_ENV_FLAG = '--require-root-env'

/** Parses dotenv-like KEY=VALUE content into an object map. */
const parseEnv = (content) => {
  /** Parsed env values keyed by variable name. */
  const parsed = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    parsed[key] = value.replace(/^['"]|['"]$/g, '')
  }

  return parsed
}

/** Reads a file and returns its UTF-8 content. */
const readFile = (filePath) => fs.readFileSync(filePath, 'utf8')

/** Resolves the local database host with self-hosted and explicit env support. */
const resolveDatabaseHost = (rootEnv) => {
  if (rootEnv.DATABASE_HOST) return rootEnv.DATABASE_HOST
  if (rootEnv.DEPLOYMENT_MODE === 'self-hosted') return SELF_HOSTED_DATABASE_HOST
  return DEFAULT_DATABASE_HOST
}

/** Builds canonical DATABASE_URL from root env primitives. */
const buildDatabaseUrl = (rootEnv) => {
  const databasePassword = rootEnv.DATABASE_PASSWORD
  if (!databasePassword) {
    throw new Error('Missing DATABASE_PASSWORD in root .env. Run ./setup.sh --fill first.')
  }

  const databaseUser = rootEnv.DATABASE_USER || DEFAULT_DATABASE_USER
  const databaseHost = resolveDatabaseHost(rootEnv)
  const databasePort = rootEnv.DATABASE_PORT || DEFAULT_DATABASE_PORT
  const databaseName = rootEnv.DATABASE_NAME || DEFAULT_DATABASE_NAME
  const encodedPassword = encodeURIComponent(databasePassword)
  return `postgresql://${databaseUser}:${encodedPassword}@${databaseHost}:${databasePort}/${databaseName}`
}

/** Parses POSTGRES_DB from docker-compose.yml for local db-name drift detection. */
const parseComposeDatabaseName = (composeContent) => {
  const match = composeContent.match(/POSTGRES_DB:\s*([^\n#]+)/)
  if (!match) return null
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}

/** Compares configured env files to canonical DATABASE_URL and reports drift. */
const checkDatabaseEnvDrift = () => {
  /** Indicates whether strict mode requires local root env availability. */
  const requireRootEnv = process.argv.includes(REQUIRE_ROOT_ENV_FLAG)

  if (!fs.existsSync(ROOT_ENV_PATH)) {
    if (requireRootEnv) {
      console.error(`DB env drift check failed: ${ROOT_ENV_PATH} is missing`)
      process.exit(1)
    }
    console.log('DB env drift check skipped: root .env is missing')
    return
  }

  const rootEnv = parseEnv(readFile(ROOT_ENV_PATH))
  const expectedDatabaseUrl = buildDatabaseUrl(rootEnv)
  /** Collected validation errors printed at the end of the run. */
  const errors = []

  if ((rootEnv.DATABASE_URL || '') !== expectedDatabaseUrl) {
    errors.push('.env: DATABASE_URL does not match DATABASE_PASSWORD-derived canonical value')
  }

  if (fs.existsSync(DOCKER_COMPOSE_PATH)) {
    const composeDbName = parseComposeDatabaseName(readFile(DOCKER_COMPOSE_PATH))
    if (composeDbName) {
      const expectedDbName = new URL(expectedDatabaseUrl).pathname.replace(/^\//, '')
      if (composeDbName !== expectedDbName) {
        errors.push(
          `docker-compose.yml: POSTGRES_DB (${composeDbName}) does not match canonical DATABASE_URL db (${expectedDbName})`
        )
      }
    }
  }

  for (const envPath of TARGET_ENV_PATHS) {
    if (!fs.existsSync(envPath)) {
      errors.push(`${path.relative(WORKSPACE_ROOT, envPath)}: missing file`)
      continue
    }

    const env = parseEnv(readFile(envPath))
    const appDatabaseUrl = env.DATABASE_URL || ''
    if (appDatabaseUrl !== expectedDatabaseUrl) {
      errors.push(`${path.relative(WORKSPACE_ROOT, envPath)}: DATABASE_URL is out of sync`)
    }
  }

  if (errors.length > 0) {
    console.error('DB env drift check failed:')
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    console.error('Run: node scripts/sync-db-env.mjs')
    process.exit(1)
  }

  console.log('DB env drift check passed')
}

checkDatabaseEnvDrift()

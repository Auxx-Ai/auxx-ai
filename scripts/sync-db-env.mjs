// scripts/sync-db-env.mjs
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

/** App env paths that should always mirror the canonical root DB/Redis settings. */
const TARGET_ENV_PATHS = [
  path.join(WORKSPACE_ROOT, 'apps/api/.env'),
  path.join(WORKSPACE_ROOT, 'apps/build/.env'),
  path.join(WORKSPACE_ROOT, 'apps/kb/.env'),
  path.join(WORKSPACE_ROOT, 'apps/web/.env'),
  path.join(WORKSPACE_ROOT, 'apps/worker/.env'),
]

/** Env example fallback suffix used to bootstrap missing env files. */
const ENV_EXAMPLE_SUFFIX = '.example'

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

/** Default local Redis host for non-self-hosted local development. */
const DEFAULT_REDIS_HOST = 'localhost'

/** Default local Redis host for self-hosted compose mode. */
const SELF_HOSTED_REDIS_HOST = 'redis'

/** Default local Redis port when REDIS_PORT is not defined. */
const DEFAULT_REDIS_PORT = '6379'

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

/** Reads an env file if it exists, otherwise returns an empty string. */
const readFileIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return ''
  return fs.readFileSync(filePath, 'utf8')
}

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

/** Resolves the local Redis host with self-hosted and explicit env support. */
const resolveRedisHost = (rootEnv) => {
  if (rootEnv.REDIS_HOST) return rootEnv.REDIS_HOST
  if (rootEnv.DEPLOYMENT_MODE === 'self-hosted') return SELF_HOSTED_REDIS_HOST
  return DEFAULT_REDIS_HOST
}

/** Builds canonical Redis connection primitives from root env. */
const buildRedisConfig = (rootEnv) => {
  const redisHost = resolveRedisHost(rootEnv)
  const redisPort = rootEnv.REDIS_PORT || DEFAULT_REDIS_PORT
  const redisPassword = rootEnv.REDIS_PASSWORD || ''

  return {
    redisHost,
    redisPort,
    redisPassword,
  }
}

/** Formats an env value using the quote style already present on the line, when available. */
const formatWithPreferredQuotes = (value, previousRawValue) => {
  if (previousRawValue?.startsWith('"') && previousRawValue.endsWith('"')) return `"${value}"`
  if (previousRawValue?.startsWith("'") && previousRawValue.endsWith("'")) return `'${value}'`
  return `"${value}"`
}

/** Upserts a key in dotenv content and returns updated content plus change flag. */
const upsertEnvKey = (content, key, value) => {
  const lines = content ? content.split(/\r?\n/) : []
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`)
  let changed = false
  let found = false

  for (let index = 0; index < lines.length; index += 1) {
    if (!keyPattern.test(lines[index])) continue

    const previousRawValue = lines[index].slice(lines[index].indexOf('=') + 1).trim()
    const formattedValue = formatWithPreferredQuotes(value, previousRawValue)
    const nextLine = `${key}=${formattedValue}`
    if (lines[index] !== nextLine) {
      lines[index] = nextLine
      changed = true
    }
    found = true
  }

  if (!found) {
    lines.push(`${key}="${value}"`)
    changed = true
  }

  const updatedContent = `${lines.join('\n').replace(/\n+$/g, '')}\n`
  return { changed, content: updatedContent }
}

/** Ensures target env file exists by copying from its .env.example when available. */
const ensureEnvFileExists = (targetPath) => {
  if (fs.existsSync(targetPath)) return false

  const examplePath = `${targetPath}${ENV_EXAMPLE_SUFFIX}`
  const targetDirectory = path.dirname(targetPath)
  if (!fs.existsSync(targetDirectory)) fs.mkdirSync(targetDirectory, { recursive: true })

  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, targetPath)
  } else {
    fs.writeFileSync(targetPath, '\n', 'utf8')
  }

  return true
}

/** Synchronizes DB/Redis env variables in root and app env files to canonical values. */
const syncDatabaseEnv = () => {
  if (!fs.existsSync(ROOT_ENV_PATH)) {
    throw new Error(`Root env file not found at ${ROOT_ENV_PATH}. Run ./setup.sh first.`)
  }

  const rootContent = readFileIfExists(ROOT_ENV_PATH)
  const rootEnv = parseEnv(rootContent)
  const canonicalDatabaseUrl = buildDatabaseUrl(rootEnv)
  const { redisHost, redisPort, redisPassword } = buildRedisConfig(rootEnv)

  /** Human-readable change messages printed at the end of the sync run. */
  const changes = []

  const rootUpdate = upsertEnvKey(rootContent, 'DATABASE_URL', canonicalDatabaseUrl)
  if (rootUpdate.changed) {
    fs.writeFileSync(ROOT_ENV_PATH, rootUpdate.content, 'utf8')
    changes.push('.env: synchronized DATABASE_URL')
  }

  for (const envPath of TARGET_ENV_PATHS) {
    const created = ensureEnvFileExists(envPath)
    const currentContent = readFileIfExists(envPath)
    const databaseUpdate = upsertEnvKey(currentContent, 'DATABASE_URL', canonicalDatabaseUrl)
    const redisHostUpdate = upsertEnvKey(databaseUpdate.content, 'REDIS_HOST', redisHost)
    const redisPortUpdate = upsertEnvKey(redisHostUpdate.content, 'REDIS_PORT', redisPort)
    const redisPasswordUpdate = upsertEnvKey(
      redisPortUpdate.content,
      'REDIS_PASSWORD',
      redisPassword
    )
    const nextContent = redisPasswordUpdate.content

    if (
      databaseUpdate.changed ||
      redisHostUpdate.changed ||
      redisPortUpdate.changed ||
      redisPasswordUpdate.changed
    ) {
      fs.writeFileSync(envPath, nextContent, 'utf8')
      changes.push(
        `${path.relative(WORKSPACE_ROOT, envPath)}: synchronized DATABASE_URL + REDIS_HOST/PORT/PASSWORD`
      )
    } else if (created) {
      changes.push(`${path.relative(WORKSPACE_ROOT, envPath)}: created`)
    }
  }

  if (changes.length === 0) {
    console.log('DB env sync: already aligned')
    return
  }

  console.log('DB env sync complete:')
  for (const change of changes) {
    console.log(`- ${change}`)
  }
}

syncDatabaseEnv()

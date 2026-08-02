// apps/lambda/src/sandbox/spawn.ts

/**
 * Parent side of the sandbox boundary — the ONLY call site for untrusted code.
 * See `plans/lambda/security/01-sandbox-hardening-plan.md` §5, §7, D1, D5, D6, D9.
 *
 * Spawns a fresh child per invocation (D6 — no warm pool, so cross-tenant state
 * reuse is not expressible), applies the four resource limits the isolate could
 * never enforce, and returns a structured result.
 */

import {
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  type SandboxConsoleLog,
  type SandboxRequest,
  type SandboxResponse,
} from './protocol.ts'

/** Response frame cap. Under `MAX_PAYLOAD_BYTES` (5 MB, index.ts) so §2.4 closes here first. */
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

/** stderr is for the parent's logs only — never echoed to callers (§7). */
const MAX_STDERR_BYTES = 64 * 1024

/** V8 fatal abort (OOM). The runner's baked `--max-old-space-size` produces this. */
const V8_OOM_EXIT_CODE = 133

/**
 * Concurrent children. Each is a Deno process with a ~30-50 MB baseline plus up
 * to its 256 MB heap cap, so this is what keeps the container inside its memory
 * ceiling (§5.1, D14).
 *
 * TODO(before Phase B ships): 4 is a DELIBERATELY CONSERVATIVE PLACEHOLDER, not a
 * measured value. The plan is explicit that this is "the one number that should be
 * measured before Phase B ships, not after" — size it against the Railway service's
 * actual memory ceiling and observed peak concurrency. `auxx-infra/config/services.json`
 * declares no resource limits, so the ceiling is the Railway plan default and has to
 * come from the dashboard.
 */
const DEFAULT_MAX_CONCURRENT = 4

function maxConcurrent(): number {
  const raw = Deno.env.get('LAMBDA_MAX_CONCURRENT_SANDBOXES')
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT
}

/** Why a sandbox run ended. Distinguished so callers can log and surface accurately. */
export type SandboxFailure =
  | 'timeout' // wall clock exceeded, child SIGKILLed
  | 'out_of_memory' // child hit its heap cap and aborted alone
  | 'output_too_large' // response frame exceeded the cap
  | 'protocol_error' // child produced no parseable frame
  | 'user_error' // the user's code threw — an ordinary outcome, not a fault
  | 'spawn_failed' // the runner binary could not be started

export interface SandboxResult {
  ok: boolean
  value?: unknown
  logs: SandboxConsoleLog[]
  failure?: SandboxFailure
  /** Safe to surface. Never contains a stack trace (§7). */
  message?: string
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

let active = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  const limit = maxConcurrent()
  if (active < limit) {
    active++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  active++
}

function release(): void {
  active--
  const next = waiting.shift()
  if (next) next()
}

// ---------------------------------------------------------------------------
// Runner resolution
// ---------------------------------------------------------------------------

/**
 * Permissions for the DEV FALLBACK only. In production these are baked into the
 * compiled runner at build time and are not expressible at spawn (D3) — which is
 * the point: a flag list on a command line is something a caller could widen.
 *
 * `--allow-net` rather than `--deny-net` is deliberate (D13, §6.1).
 */
const DEV_RUNNER_FLAGS = [
  '--deny-env',
  '--deny-read',
  '--deny-write',
  '--deny-ffi',
  '--deny-run',
  '--deny-sys',
  '--allow-net',
  '--v8-flags=--max-old-space-size=256',
]

interface RunnerCommand {
  path: string
  args: string[]
}

/** Where Dockerfile.server COPYs the runner, and the target of the parent's --allow-run grant. */
const DEFAULT_RUNNER_PATH = '/runner'

/**
 * Locate the runner.
 *
 * Production FAILS CLOSED: if no compiled runner is configured we throw rather
 * than falling back to a flag-configured `deno run`, because the fallback's
 * permissions live on a command line instead of inside the binary. Silently
 * degrading the boundary is exactly the failure mode A5 fixed on the auth path.
 */
function resolveRunner(): RunnerCommand {
  const configured = Deno.env.get('LAMBDA_RUNNER_PATH')
  if (configured) return { path: configured, args: [] }

  // The dev fallback is OPT-IN, and the default is the compiled binary.
  //
  // Auto-detecting "am I a compiled binary?" was tried and does not work: inside a
  // `deno compile` output `import.meta.url` is still a file: URL, so the check
  // silently inverted and the parent tried to exec ITSELF (`/server`) as the
  // sandbox. Deno exposes no reliable is-compiled signal, and a misdetection here
  // fails toward the weaker mode — flags on a command line instead of permissions
  // baked into a binary (D3). So it is stated explicitly or not used at all.
  const devRunnerRequested = Deno.env.get('LAMBDA_SANDBOX_DEV_RUNNER') === '1'
  const isProduction = Deno.env.get('NODE_ENV') === 'production'

  if (devRunnerRequested && !isProduction) {
    const source = new URL('./runner.ts', import.meta.url)
    return { path: Deno.execPath(), args: ['run', ...DEV_RUNNER_FLAGS, source.pathname] }
  }

  return { path: DEFAULT_RUNNER_PATH, args: [] }
}

// ---------------------------------------------------------------------------
// Stream reading
// ---------------------------------------------------------------------------

/**
 * Read a stream up to `limit` bytes. Signals rather than throws on overflow so
 * the caller can kill the child before it produces more.
 */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  onOverflow: () => void
): Promise<{ text: string; overflowed: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let overflowed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      size += value.length
      if (size > limit) {
        overflowed = true
        onOverflow()
        break
      }
      chunks.push(value)
    }
  } catch {
    // Child died mid-stream (kill, OOM). Whatever arrived is what we have.
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }

  const merged = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return { text: new TextDecoder().decode(merged), overflowed }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Execute untrusted code in a child process.
 *
 * Never throws for anything the user's code did — a thrown user error comes back
 * as `{ ok: false, failure: 'user_error' }`. It throws only if the runner itself
 * could not be resolved, which is a deployment fault.
 */
export async function runInSandbox(
  request: Omit<SandboxRequest, 'v'>,
  timeout: number
): Promise<SandboxResult> {
  const runner = resolveRunner()

  await acquire()

  let child: Deno.ChildProcess
  try {
    child = new Deno.Command(runner.path, {
      args: runner.args,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
      // D5 — `--deny-env` blocks the `Deno.env` API but leaves variables in the
      // child's OS process environment, where `/proc/self/environ` and the node
      // compat layer can still reach them. Both controls are required.
      clearEnv: true,
      env: {},
    }).spawn()
  } catch (error) {
    release()
    return {
      ok: false,
      logs: [],
      failure: 'spawn_failed',
      message: `sandbox runner could not be started: ${(error as Error)?.message ?? 'unknown'}`,
    }
  }

  let failure: SandboxFailure | undefined
  let killed = false

  const kill = () => {
    if (killed) return
    killed = true
    try {
      // SIGKILL, not SIGTERM — this is the one thing `Promise.race` could never
      // do (§2.3): it preempts a synchronous `while(true)` that no timer can
      // interrupt, because the child has no say in receiving it.
      child.kill('SIGKILL')
    } catch {
      // already exited
    }
  }

  const timer = setTimeout(() => {
    failure = 'timeout'
    kill()
  }, timeout)

  // Write and read concurrently. The child drains stdin to EOF before executing,
  // and awaiting the write first would deadlock against a child that dies early.
  const writeStdin = (async () => {
    try {
      const writer = child.stdin.getWriter()
      await writer.write(encodeFrame({ v: PROTOCOL_VERSION, ...request }))
      await writer.close()
    } catch {
      // BrokenPipe — the child was killed or exited. The read side reports it.
    }
  })()

  const [stdout, stderr, status] = await Promise.all([
    readCapped(child.stdout, MAX_OUTPUT_BYTES, () => {
      failure = 'output_too_large'
      kill()
    }),
    readCapped(child.stderr, MAX_STDERR_BYTES, () => {}),
    child.status,
  ])

  clearTimeout(timer)
  await writeStdin
  release()

  if (stderr.text.trim()) {
    // Parent-side only. V8 fatal traces name host paths and memory layout, so
    // this must never reach the response body (§7).
    console.error('[sandbox] child stderr:', stderr.text.slice(0, 2000))
  }

  if (failure === 'timeout') {
    return { ok: false, logs: [], failure, message: `Code execution timeout after ${timeout}ms` }
  }

  if (failure === 'output_too_large') {
    return {
      ok: false,
      logs: [],
      failure,
      message: `Execution result exceeded ${MAX_OUTPUT_BYTES} bytes`,
    }
  }

  // The child OOMs alone. This is the measured contrast with a Worker, which
  // aborts the entire host process on the same input (§4.2, exit 133).
  if (status.code === V8_OOM_EXIT_CODE || status.signal === 'SIGTRAP') {
    return {
      ok: false,
      logs: [],
      failure: 'out_of_memory',
      message: 'Code execution exceeded the memory limit',
    }
  }

  const response = decodeFrame<SandboxResponse>(stdout.text.trim())
  if (!response) {
    return {
      ok: false,
      logs: [],
      failure: 'protocol_error',
      message: 'Sandbox produced no result',
    }
  }

  if (response.ok) {
    return { ok: true, value: response.value, logs: response.logs ?? [] }
  }

  return {
    ok: false,
    logs: response.logs ?? [],
    failure: 'user_error',
    message: `${response.error.name}: ${response.error.message}`,
  }
}

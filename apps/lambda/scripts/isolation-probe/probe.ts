// apps/lambda/scripts/isolation-probe/probe.ts

/**
 * Process-isolation probe — `plans/lambda/security/01-sandbox-hardening-plan.md` D3, §10 row 9.
 *
 * Runs INSIDE Docker (see ../probe-isolation.sh). `deno compile` invoked on the host
 * Mac from `apps/lambda` grows unbounded (~84 GB RSS, session killed); the identical
 * compile in a container takes about a second. Do not run this directly on the host.
 *
 * WHAT THIS PROBES, AND WHY IT IS NOT THE BRANCH'S TEST SUITE.
 *
 * `sandbox-mitigation.test.ts` already asserts that `--deny-run` denies. It runs the
 * child through the DEV FALLBACK, where permissions arrive as command-line flags, and
 * its own header says so. That leaves two claims untested, and they are the two that
 * make the denial worth anything:
 *
 *   1. NON-VACUITY. `clearEnv: true` (D5) leaves the child with no PATH, so a bare
 *      `Deno.Command('sh')` fails with "no path to search" — an incidental resolution
 *      failure that keeps passing after `--allow-run` is granted. A denial assertion
 *      is only evidence if the same call SUCCEEDS against a runner compiled with the
 *      permission. This probe compiles that second runner and requires it to succeed.
 *
 *   2. D3 — permissions baked in at compile time "cannot be widened at spawn time".
 *      Listed under §9 "Not yet probed". The whole design rests on it: if a compiled
 *      binary honoured permission flags from argv, any code that can influence the
 *      spawn line could re-grant what the build took away.
 *
 * Exit code is 0 only if every expectation below holds.
 */

const DENO = Deno.execPath()
const WORK = '/work'
const CHILD_SRC = '/probe/child.ts'

/** §5.1 runner permissions, with D13's `--allow-net` (the egress broker is deferred). */
const DENY_ALL = [
  '--deny-env',
  '--deny-read',
  '--deny-write',
  '--deny-ffi',
  '--deny-run',
  '--deny-sys',
  '--allow-net',
  '--v8-flags=--max-old-space-size=256',
]

/** The control: identical, except process spawning is granted. */
const PERMISSIVE = DENY_ALL.map((f) => (f === '--deny-run' ? '--allow-run=/bin/sh' : f))

/**
 * A second control, for the `node:child_process` routes only.
 *
 * Deno's node-compat layer reads the environment while assembling a child process, so
 * under `--deny-env` it throws `NotCapable` for ENV access before the run permission is
 * ever consulted. `--allow-run` alone therefore does not make those calls succeed, and
 * a denial test written against PERMISSIVE would look vacuous when it is really being
 * masked by an unrelated permission. Granting both isolates the run permission.
 */
const PERMISSIVE_NODE = PERMISSIVE.map((f) => (f === '--deny-env' ? '--allow-env' : f))

/**
 * Env granted, run still denied — the deny-side partner to PERMISSIVE_NODE.
 *
 * With env out of the way the run permission is the only thing left that can stop a
 * `node:child_process` call, so a `NotCapable` here is unambiguous evidence about
 * `--deny-run` through the node-compat route. Against the plain DENY_ALL runner the
 * same call is stopped by env first and proves nothing about run.
 */
const DENY_RUN_ONLY = DENY_ALL.map((f) => (f === '--deny-env' ? '--allow-env' : f))

interface Reply {
  outcome: 'ok' | 'threw'
  name: string
  detail: string
}

async function compile(flags: string[], output: string): Promise<void> {
  const cmd = new Deno.Command(DENO, {
    args: ['compile', '--no-config', ...flags, '--output', output, CHILD_SRC],
    stdout: 'piped',
    stderr: 'piped',
  })
  const { code, stderr } = await cmd.output()
  if (code !== 0) {
    console.error(new TextDecoder().decode(stderr))
    throw new Error(`compile failed for ${output}`)
  }
}

/**
 * Send one expression to a compiled runner and read its verdict.
 *
 * `clearEnv: true` mirrors D5 — `--deny-env` only blocks the `Deno.env` API, it does
 * not remove variables from the child's OS environment. Keeping it here is also what
 * makes the no-PATH trap reproducible, which is half the point of this probe.
 */
async function ask(runner: string, source: string, extraArgs: string[] = []): Promise<Reply> {
  const child = new Deno.Command(runner, {
    args: extraArgs,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
    clearEnv: true,
    env: {},
  }).spawn()

  const writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(source))
  await writer.close()

  const { stdout, stderr, code } = await child.output()
  const out = new TextDecoder().decode(stdout).trim()
  if (!out) {
    return {
      outcome: 'threw',
      name: `NO_OUTPUT(exit ${code})`,
      detail: new TextDecoder().decode(stderr).trim().slice(0, 200),
    }
  }
  // Take the last line, and surface a parse failure as a result rather than throwing.
  // If an attempt ever leaks non-protocol output onto stdout that is a finding about
  // the attempt, not a reason to abort the run.
  const last =
    out
      .split('\n')
      .filter((l) => l.trim())
      .pop() ?? ''
  try {
    return JSON.parse(last) as Reply
  } catch {
    return { outcome: 'threw', name: 'UNPARSEABLE_OUTPUT', detail: out.slice(0, 200) }
  }
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface Attempt {
  label: string
  source: string
  /** Expected error name from the deny-all runner. */
  denied: string
  /**
   * Substring the deny-all runner's error message must contain, naming WHICH permission
   * did the denying. `NotCapable` alone is not enough: an attempt denied for env access
   * is not evidence about run access, and would keep passing after `--allow-run` was
   * granted. This is the assertion that catches that.
   */
  deniedBecause?: string
  /**
   * What the control runner must do for the denial above to be meaningful.
   * `'NO_THROW'` means the call genuinely succeeds once the permission is granted —
   * that is the non-vacuity proof. Anything else is documented in `note`.
   */
  permissive: string
  /** Runner the denial is asserted against. Defaults to DENY_ALL. */
  deniedFlags?: string[]
  /** Runner the non-vacuity control runs on. Defaults to PERMISSIVE. */
  control?: string[]
  note?: string
}

const ATTEMPTS: Attempt[] = [
  {
    label: 'Deno.Command(/bin/sh).outputSync()',
    source: "return new Deno.Command('/bin/sh', { args: ['-c', 'id'] }).outputSync().code",
    denied: 'NotCapable',
    deniedBecause: 'run access',
    permissive: 'NO_THROW',
  },
  {
    label: 'Deno.Command(/bin/sh).output()  [async]',
    source: "return (await new Deno.Command('/bin/sh', { args: ['-c', 'id'] }).output()).code",
    denied: 'NotCapable',
    deniedBecause: 'run access',
    permissive: 'NO_THROW',
  },
  {
    label: 'Deno.Command(/bin/sh).spawn()',
    // stdout/stderr are nulled deliberately. `.spawn()` INHERITS them by default, so
    // on the permissive runner the grandchild's `uid=0(root)` is written straight into
    // the same stdout this probe parses as protocol. `outputSync`/`output` pipe by
    // default and do not have this problem. It is the probe-scale version of exactly
    // what §4 of the compute plan handles by keeping user output off the frame channel.
    source:
      "return (await new Deno.Command('/bin/sh', { args: ['-c', 'id'], stdout: 'null', stderr: 'null' }).spawn().status).code",
    denied: 'NotCapable',
    deniedBecause: 'run access',
    permissive: 'NO_THROW',
  },
  {
    label: "Deno.Command('sh')  [bare, no PATH]",
    source: "return new Deno.Command('sh', { args: ['-c', 'id'] }).outputSync().code",
    // THE TRAP, made visible. Under clearEnv neither runner can resolve a bare name,
    // so both fail identically with a plain `Error` — "no path to search". This attempt
    // CANNOT distinguish denied from permitted, and asserting row 9 on it would pass
    // forever, including after --allow-run is granted. Recorded so the suite has a
    // worked example of a vacuous denial rather than only a prose warning.
    denied: 'Error',
    deniedBecause: 'no path to search',
    permissive: 'Error',
    note: 'VACUOUS — identical on both; never assert row 9 on a bare name',
  },
  {
    label: 'typeof Deno.Command',
    source: 'return typeof Deno.Command',
    denied: 'NO_THROW',
    permissive: 'NO_THROW',
    note: 'constructor is present regardless of permission — never assert on this',
  },
  {
    label: "node:child_process execFileSync('/bin/sh')",
    source:
      "const cp = await import('node:child_process'); return cp.execFileSync('/bin/sh', ['-c', 'id']).toString()",
    denied: 'NotCapable',
    // Note WHICH permission answers. The node-compat layer touches the environment
    // while assembling the child, so under the real runner's flags this is an ENV
    // denial that never reaches the run check — see PERMISSIVE_NODE.
    deniedBecause: 'env access',
    permissive: 'NO_THROW',
    control: PERMISSIVE_NODE,
    note: 'denied via env, not run — needs the env+run control to be non-vacuous',
  },
  {
    label: "node:child_process spawnSync('/bin/sh')",
    source:
      "const cp = await import('node:child_process'); const r = cp.spawnSync('/bin/sh', ['-c', 'id']); if (r.error) throw r.error; return r.status",
    denied: 'NotCapable',
    deniedBecause: 'env access',
    permissive: 'NO_THROW',
    control: PERMISSIVE_NODE,
    note: 'denied via env, not run',
  },
  {
    label: 'node:child_process  [env granted, run denied]',
    // The isolating case: env is granted on BOTH sides, so the only difference between
    // them is the run permission. A NotCapable here is unambiguous evidence about
    // --deny-run through the node-compat route, which the two rows above cannot give.
    source:
      "const cp = await import('node:child_process'); return cp.execFileSync('/bin/sh', ['-c', 'id']).toString()",
    // MEASURED, and not what the plan's "assert a specific NotCapable" rule expects.
    // With env out of the way the run denial is real — the control succeeds, this does
    // not — but node-compat SWALLOWS it into a generic `Error: Command failed`. There is
    // no NotCapable and nothing in the message identifying a permission boundary.
    //
    // Consequence for §10: on the shipping runner (--deny-env --deny-run) a
    // node:child_process attempt does return NotCapable, but for ENV. If the child is
    // ever granted --allow-env, that assertion degrades to this generic Error — so a
    // test written as "assert NotCapable" breaks confusingly, and one written as
    // "assert it throws" keeps passing while proving nothing. Assert the Deno.Command
    // route for run denial; treat the node route as a reachability check only.
    denied: 'Error',
    deniedBecause: 'Command failed',
    permissive: 'NO_THROW',
    deniedFlags: DENY_RUN_ONLY,
    control: PERMISSIVE_NODE,
    note: 'run denial REAL but reported as a generic Error — no NotCapable to assert on',
  },
]

/**
 * D3 — the parent must not be able to re-grant what the build denied.
 *
 * A compiled binary treats argv as the program's own arguments, so these should land
 * in `Deno.args` and change nothing. Asserted rather than assumed, because the failure
 * mode is silent: the spawn line is the one part of the boundary that ordinary code
 * can influence.
 */
const WIDENING_ATTEMPTS: string[][] = [
  ['--allow-run'],
  ['--allow-run=/bin/sh'],
  ['--allow-all'],
  ['-A'],
]

// ---------------------------------------------------------------------------

let failures = 0

function check(ok: boolean, line: string): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${line}`)
}

console.log(`deno ${Deno.version.deno}\n`)

/** One compiled binary per distinct flag set, built on first use. */
const runners = new Map<string, string>()
let compileCount = 0
async function runnerFor(flags: string[]): Promise<string> {
  const key = flags.join(' ')
  const existing = runners.get(key)
  if (existing) return existing
  const path = `${WORK}/runner-${compileCount++}`
  await compile(flags, path)
  runners.set(key, path)
  return path
}

console.log('1. capability matrix — each attempt against a denied runner and a control')
console.log(`   ${'attempt'.padEnd(44)} ${'denied'.padEnd(13)} ${'control'.padEnd(13)} verdict`)

const t0 = performance.now()
for (const a of ATTEMPTS) {
  const deniedRunner = await runnerFor(a.deniedFlags ?? DENY_ALL)
  const controlRunner = await runnerFor(a.control ?? PERMISSIVE)

  const d = await ask(deniedRunner, a.source)
  const p = await ask(controlRunner, a.source)
  const dName = d.outcome === 'ok' ? 'NO_THROW' : d.name
  const pName = p.outcome === 'ok' ? 'NO_THROW' : p.name

  // Three conditions, and the middle one is the one that is usually skipped:
  //   - the denied runner denies as expected
  //   - it denies for the RIGHT reason (deniedBecause)
  //   - the control behaves differently, or the attempt is explicitly marked vacuous
  const reasonOk = !a.deniedBecause || d.detail.includes(a.deniedBecause)
  const ok = dName === a.denied && pName === a.permissive && reasonOk

  const vacuous = dName === pName && d.detail === p.detail
  const verdict = a.note ?? (vacuous ? 'VACUOUS — control behaves identically' : 'non-vacuous')
  check(ok, `${a.label.padEnd(44)} ${dName.padEnd(13)} ${pName.padEnd(13)} ${verdict}`)
  if (!ok) {
    console.log(
      `        expected ${a.denied} / ${a.permissive}, because "${a.deniedBecause ?? '-'}"`
    )
    console.log(`        denied  detail: ${d.detail}`)
    console.log(`        control detail: ${p.detail}`)
  }
}
console.log(`   (${runners.size} runners compiled, ${Math.round(performance.now() - t0)} ms total)`)

console.log('\n2. D3 — a compiled binary ignores permission flags passed at spawn time')
const denied = await runnerFor(DENY_ALL)
const probe = "return new Deno.Command('/bin/sh', { args: ['-c', 'id'] }).outputSync().code"
for (const args of WIDENING_ATTEMPTS) {
  const r = await ask(denied, probe, args)
  const name = r.outcome === 'ok' ? 'NO_THROW' : r.name
  check(name === 'NotCapable', `spawn with ${args.join(' ').padEnd(24)} -> ${name}`)
}

// The flags must not have been swallowed as permissions — they should be visible to
// the program as ordinary arguments. If they vanish, the binary IS parsing them and
// the check above is passing for a reason we have not established.
const argvSeen = await ask(denied, 'return JSON.stringify(Deno.args)', ['--allow-run'])
check(
  argvSeen.detail.includes('--allow-run'),
  `flags reach Deno.args as plain arguments -> ${argvSeen.detail}`
)

console.log(`\n${failures === 0 ? 'ALL EXPECTATIONS HELD' : `${failures} EXPECTATION(S) VIOLATED`}`)
Deno.exit(failures === 0 ? 0 : 1)

// apps/lambda/scripts/isolation-probe/child.ts

/**
 * The probe's sandbox child — a minimal stand-in for `src/sandbox/runner.ts`.
 *
 * Reads one line of JavaScript on stdin, evaluates it, and writes one line of JSON
 * on stdout: `{ outcome, name, detail }`. It is deliberately NOT the real runner —
 * this probe tests the Deno permission model that D3 rests on, not our framing code,
 * so it must stay free of anything that could itself deny an operation and produce a
 * pass for the wrong reason.
 *
 * `new Function` needs no permission, so evaluation works under `--deny-*` everything.
 */

type Outcome = 'ok' | 'threw'

interface Reply {
  outcome: Outcome
  /** Error constructor name — `NotCapable` is the denial we assert on. */
  name: string
  detail: string
}

function reply(r: Reply): string {
  return `${JSON.stringify(r)}\n`
}

async function evaluate(source: string): Promise<Reply> {
  try {
    // `async` so bodies may `await import(...)`. A non-async wrapper turns a dynamic
    // import into a SyntaxError, which fails a denial test for an unrelated reason
    // (plan §9, trap 2).
    const fn = new Function(`return (async () => { ${source} })()`) as () => Promise<unknown>
    const value = await fn()
    return { outcome: 'ok', name: 'NO_THROW', detail: String(value).slice(0, 200) }
  } catch (e) {
    const err = e as Error
    return {
      outcome: 'threw',
      name: err?.name ?? 'Unknown',
      detail: (err?.message ?? '').slice(0, 200),
    }
  }
}

const line = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer())
const result = await evaluate(line)
await Deno.stdout.write(new TextEncoder().encode(reply(result)))

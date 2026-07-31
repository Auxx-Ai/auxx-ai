export class Ok<V> {
  public readonly error: undefined = undefined

  constructor(public readonly value: V) {}

  public bind<T>(fn: (value: V) => T): T {
    return fn(this.value)
  }

  public unwrap(): V {
    return this.value
  }

  /**
   * Typed as the literal `true` (not `boolean`) on purpose: it is the
   * discriminant that makes {@link TypedResult} a discriminated union, so
   * `if (result.ok)` narrows to `Ok<V>` and `result.value` is `V` rather than
   * `V | undefined`. Widening this back to `boolean` silently un-narrows every
   * `.value` / `.error` access in the codebase.
   */
  public get ok(): true {
    return true
  }
}

export class ErrorResult<E extends Error> {
  public readonly value: undefined = undefined

  constructor(public readonly error: E) {}

  public bind(): ErrorResult<E> {
    return this
  }

  public unwrap(): never {
    throw this.error
  }

  /** Literal `false` — see {@link Ok.ok}. */
  public get ok(): false {
    return false
  }
}

export type TypedResult<V, E extends Error> = Ok<V> | ErrorResult<E>

export class Result {
  private constructor() {}

  public static ok<V>(value: V): Ok<V> {
    return new Ok(value)
  }

  public static nil(): Ok<undefined> {
    return new Ok(undefined)
  }

  public static error<E extends Error>(error: E): ErrorResult<E> {
    return new ErrorResult(error)
  }

  public static isOk<V>(result: TypedResult<V, Error>): result is Ok<V> {
    return result.ok
  }

  public static findError<E extends Error>(
    results: TypedResult<any, E>[]
  ): ErrorResult<E> | undefined {
    return results.find((r) => !r.ok) as ErrorResult<E> | undefined
  }
}

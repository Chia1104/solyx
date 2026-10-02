/** The message of a thrown value, which need not be an `Error`. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Narrows a thrown value to a Node system error with `code`, such as `ENOENT`. */
export function isErrnoError(
  error: unknown,
  code: string
): error is Error & { code: string } {
  return error instanceof Error && "code" in error && error.code === code;
}

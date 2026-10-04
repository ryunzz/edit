const pending = new Set<Promise<unknown>>();

/**
 * Hold the current frame until `promise` settles. Use for anything that loads
 * (data, fonts, images drawn by hand) so a frame is only captured once it is ready.
 */
export function waitFor<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  promise.then(
    () => pending.delete(promise),
    () => pending.delete(promise),
  );
  return promise;
}

/** Resolves once nothing is pending, or rejects after `timeoutMs`. */
export async function settle(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${pending.size} pending load(s)`);
    }
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((resolve) => setTimeout(resolve, remaining)),
    ]);
  }
}

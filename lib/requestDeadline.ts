/** React Native 0.81's AbortSignal has no static timeout()/any() methods. */
export async function withRequestDeadline<T>(
  work: (signal: AbortSignal) => PromiseLike<T>,
  external?: AbortSignal,
  milliseconds = 12000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, milliseconds);
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  try {
    if (controller.signal.aborted) {
      const error = new Error("request_aborted");
      error.name = "AbortError";
      throw error;
    }
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
  }
}

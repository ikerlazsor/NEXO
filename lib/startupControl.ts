export const STARTUP_TIMEOUT_MS = 12_000;

export type StartupFailureKind = 'offline' | 'timeout' | 'unexpected';

export type StartupFailure = {
  kind: StartupFailureKind;
  message: string;
};

export type StartupRunResult<T> =
  | { status: 'success'; value: T }
  | { status: 'stale' }
  | { status: 'failure'; failure: StartupFailure };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown startup error';
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

export function classifyStartupFailure(
  error: unknown,
  online: boolean,
): StartupFailure {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const looksLikeNetworkFailure =
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('internet') ||
    normalized.includes('offline');

  if (!online || looksLikeNetworkFailure) {
    return { kind: 'offline', message };
  }
  return { kind: 'unexpected', message };
}

/**
 * Ejecuta únicamente el intento de arranque más reciente. Al comenzar uno nuevo
 * aborta el anterior, y un temporizador corta las consultas que admiten AbortSignal.
 */
export class StartupCoordinator {
  private generation = 0;
  private activeController: AbortController | null = null;

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: {
      timeoutMs?: number;
      isOnline?: () => boolean;
    } = {},
  ): Promise<StartupRunResult<T>> {
    this.activeController?.abort();
    const controller = new AbortController();
    this.activeController = controller;
    const runGeneration = ++this.generation;
    const timeoutMs = options.timeoutMs ?? STARTUP_TIMEOUT_MS;
    let timedOut = false;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('Startup timed out'));
      }, timeoutMs);
    });
    const cancellation = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          const error = new Error('Startup attempt aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });

    try {
      const value = await Promise.race([operation(controller.signal), deadline, cancellation]);
      if (runGeneration !== this.generation || controller.signal.aborted) {
        return { status: 'stale' };
      }
      return { status: 'success', value };
    } catch (error) {
      if (runGeneration !== this.generation) return { status: 'stale' };
      if (timedOut) {
        return {
          status: 'failure',
          failure: { kind: 'timeout', message: 'Startup timed out' },
        };
      }
      if (controller.signal.aborted || isAbortError(error)) {
        return { status: 'stale' };
      }
      return {
        status: 'failure',
        failure: classifyStartupFailure(error, options.isOnline?.() ?? true),
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (runGeneration === this.generation) this.activeController = null;
    }
  }

  cancel(): void {
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Startup attempt aborted');
    error.name = 'AbortError';
    throw error;
  }
}

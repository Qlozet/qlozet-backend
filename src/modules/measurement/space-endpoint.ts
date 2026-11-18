/**
 * The Gradio client looks a route up by its registered api_name after
 * trimming ONE leading slash. The measurement Space registers its routes as
 * api_name="/run_predict", so the name is "/run_predict" and must be called
 * as "//run_predict"; a route registered as "run_predict" is called as
 * "/run_predict". Asking for a name that doesn't exist is worse than an
 * error: the client throws inside a Promise executor, the rejection escapes
 * unhandled and predict() never settles — the job hangs for ever.
 *
 * So: find the route that exists, and call it by the name that reaches it.
 * Returns null when the Space has neither.
 */
export function spaceEndpoint(client: any, name: string): string | null {
  const bare = name.replace(/^\/+/, '');
  const map = client?.api_map;
  if (!map || typeof map !== 'object') return `/${bare}`; // can't tell; best guess
  if (`/${bare}` in map) return `//${bare}`;
  if (bare in map) return `/${bare}`;
  return null;
}

/** Reject after [ms] instead of waiting on a call that may never settle. */
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Per-domain request throttle. Each domain gets a minimum-interval gate
// derived from its configured requests-per-second; callers await acquire()
// before making a request, which sleeps just long enough (plus jitter) to
// respect the limit, based on when that domain was last hit.
const lastRequestAt = new Map<string, number>();
const queues = new Map<string, Promise<void>>();

function jitterMs(baseMs: number): number {
  // +/- 20% jitter so requests to the same domain don't fall into a
  // perfectly predictable cadence.
  const jitter = baseMs * 0.2;
  return baseMs + (Math.random() * 2 - 1) * jitter;
}

export async function acquireSlot(domain: string, rps: number, crawlDelaySec?: number): Promise<void> {
  const minIntervalMs = crawlDelaySec
    ? crawlDelaySec * 1000
    : 1000 / Math.max(rps, 0.01);

  const prev = queues.get(domain) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(domain, next);

  await prev;
  try {
    const last = lastRequestAt.get(domain) ?? 0;
    const elapsed = Date.now() - last;
    const wait = jitterMs(minIntervalMs) - elapsed;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    lastRequestAt.set(domain, Date.now());
  } finally {
    release!();
  }
}

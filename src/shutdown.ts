type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let running: Promise<void> | null = null;

/** Memory close registers here so /exit and a normal readline close both run it. */
export function onShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

export function shutdown(): Promise<void> {
  running ??= run();
  return running;
}

async function run(): Promise<void> {
  const pending = hooks.splice(0);
  for (const hook of pending) {
    try {
      await hook();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`shutdown: ${message}\n`);
    }
  }
}

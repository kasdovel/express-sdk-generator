import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { loadConfig } from './load.js';
import { resolveConfigPath, type SdkgenConfig } from './config.js';
import {
  artifactTargets,
  generate,
  type GenerateOptions,
  type GenerateResult,
} from './generate.js';

/** Directory names never worth re-importing for. */
const IGNORED_DIRS = new Set(['node_modules', '.git', '.turbo', 'dist', 'build', 'coverage']);

/** Extensions jiti can pull into the entry's module graph. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];

export interface SourceWatcher {
  /** Absolute paths handed to `fs.watch`. Useful in tests and diagnostics. */
  readonly roots: readonly string[];
  close(): void;
}

export interface SourceWatchOptions {
  /** Collapse bursts of filesystem events into one call. Default 120ms. */
  debounceMs?: number;
  onChange: (path: string) => void;
}

function isIgnoredPath(path: string, artifacts: string[]): boolean {
  const segments = path.split(sep);
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return true;
  // Regenerating writes the artifacts; reacting to those writes would loop.
  if (artifacts.some((out) => path === out || path.startsWith(out + sep))) return true;
  return SOURCE_EXTENSIONS.every((ext) => !path.endsWith(ext));
}

/**
 * Watch the entry module's directory (and the config file) for source changes.
 *
 * jiti gives no module graph to follow, so the unit of watching is the entry's
 * directory rather than its imports: over-broad, but it cannot miss a
 * transitively imported file, which is the failure that would matter. The
 * generated artifacts are excluded so a regeneration cannot trigger itself.
 */
export function watchSources(
  config: SdkgenConfig,
  configPath: string,
  options: SourceWatchOptions,
): SourceWatcher {
  const baseDir = dirname(configPath);
  const artifacts = artifactTargets(config, baseDir).map((target) => target.path);
  const entryDir = dirname(resolve(baseDir, config.entry));
  const roots = entryDir === baseDir ? [baseDir] : [baseDir, entryDir];

  const debounceMs = options.debounceMs ?? 120;
  let timer: NodeJS.Timeout | undefined;
  let latest = '';

  const schedule = (path: string) => {
    latest = path;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      options.onChange(latest);
    }, debounceMs);
    // A pending regeneration should not be what keeps the CLI alive.
    timer.unref?.();
  };

  const watchers: FSWatcher[] = [];
  for (const root of roots) {
    const watcher = fsWatch(root, { recursive: true }, (_event, filename) => {
      // A null filename gives nothing to filter on, and acting on it would let
      // our own writes retrigger the run.
      if (!filename) return;
      const path = resolve(root, filename.toString());
      if (!isIgnoredPath(path, artifacts)) schedule(path);
    });
    watcher.on('error', () => watcher.close());
    watchers.push(watcher);
  }

  return {
    roots,
    close() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      for (const watcher of watchers) watcher.close();
    },
  };
}

/** The outcome of one regeneration inside `sdkgen gen --watch`. */
export interface WatchRun {
  ok: boolean;
  result?: GenerateResult;
  error?: unknown;
  durationMs: number;
  /** The file that triggered it; absent for the first, unprompted run. */
  trigger?: string;
}

export interface WatchOptions extends GenerateOptions {
  debounceMs?: number;
  /** Reported per regeneration. Printing is the CLI's job, not this module's. */
  onRun?: (run: WatchRun) => void;
}

export interface Watcher {
  readonly roots: readonly string[];
  /** Stop watching and wait for any regeneration still in flight. */
  close(): Promise<void>;
}

/**
 * Regenerate on every change under the entry's directory, forever.
 *
 * A failing run is reported but never fatal: a watch session exists precisely
 * so a broken intermediate state can be fixed and retried without restarting.
 */
export async function watch(options: WatchOptions = {}): Promise<Watcher> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = resolveConfigPath(cwd, options.configPath);
  // The first load is deliberately not caught: a config that cannot be read is
  // a startup failure, not something to sit in a loop retrying.
  const config = await loadConfig(configPath);

  let inFlight: Promise<void> = Promise.resolve();
  let closed = false;

  // Runs are chained rather than started eagerly: two overlapping generations
  // would race on the same output files.
  const run = (trigger?: string): Promise<void> => {
    inFlight = inFlight.then(async () => {
      const started = Date.now();
      try {
        const result = await generate({ cwd, configPath, only: options.only });
        options.onRun?.({ ok: true, result, durationMs: Date.now() - started, trigger });
      } catch (error) {
        options.onRun?.({ ok: false, error, durationMs: Date.now() - started, trigger });
      }
    });
    return inFlight;
  };

  await run();

  const sources = watchSources(config, configPath, {
    debounceMs: options.debounceMs,
    onChange: (path) => {
      if (!closed) void run(path);
    },
  });

  return {
    roots: sources.roots,
    async close() {
      closed = true;
      sources.close();
      await inFlight;
    },
  };
}

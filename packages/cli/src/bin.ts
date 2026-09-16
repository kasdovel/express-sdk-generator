#!/usr/bin/env node
import { Command, type OptionValues } from 'commander';
import { generate, type Artifact, type GenerateResult } from './generate.js';
import { serve } from './serve.js';
import { check, type CheckResult } from './check.js';
import { init } from './init.js';
import { watch, type WatchRun } from './watch.js';

const program = new Command();

program
  .name('sdkgen')
  .description('Generate OpenAPI spec, docs, and a typed TS SDK from an Express app');

interface GenFlags {
  config?: string;
  watch?: boolean;
}

/** Report a failure the way a CLI should: one clear line, stack behind a flag. */
function fail(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`✗ ${message}`);
  // Stacks are noise for the common case (a bad config, a broken entry module);
  // SDKGEN_DEBUG=1 brings them back when the message is not enough.
  if (process.env.SDKGEN_DEBUG && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exitCode = 1;
}

function printResult(result: GenerateResult): void {
  if (result.specPath) console.log(`✓ spec   ${result.specPath}`);
  if (result.yamlPath) console.log(`✓ spec   ${result.yamlPath}`);
  if (result.docsPath) console.log(`✓ docs   ${result.docsPath}`);
  if (result.sdkDir) console.log(`✓ sdk    ${result.sdkDir}`);
}

/** One line per regeneration — a watch session should read like a log, not a report. */
function printWatchRun(run: WatchRun): void {
  const at = new Date().toTimeString().slice(0, 8);
  const from = run.trigger ? ` ← ${run.trigger}` : '';
  if (!run.ok) {
    const message = run.error instanceof Error ? run.error.message : String(run.error);
    console.error(`✗ ${at} ${message}${from}`);
    return;
  }
  const what = [
    run.result?.specPath && 'spec',
    run.result?.docsPath && 'docs',
    run.result?.sdkDir && 'sdk',
  ]
    .filter(Boolean)
    .join(' ');
  console.log(`✓ ${at} ${what || 'nothing to do'} (${String(run.durationMs)}ms)${from}`);
}

async function run(only: Artifact[] | undefined, flags: GenFlags): Promise<void> {
  try {
    if (flags.watch) {
      // Resolves once watching is set up; the fs watchers keep the process
      // alive from here until the user interrupts it.
      await watch({ configPath: flags.config, only, onRun: printWatchRun });
      console.log('Watching for changes — press Ctrl+C to stop.');
      return;
    }
    printResult(await generate({ configPath: flags.config, only }));
  } catch (err) {
    fail(err);
  }
}

const gen = program
  .command('gen')
  .description('Generate artifacts')
  .option('-c, --config <path>', 'path to config file')
  .option('-w, --watch', 'regenerate when the entry module or its imports change');

// The shared flags live on the parent `gen` command, so each subcommand reads
// its parent's options.
const genFlags = (cmd: Command): GenFlags => cmd.parent?.opts<GenFlags>() ?? {};

gen
  .command('spec')
  .description('Generate only the OpenAPI spec')
  .action((_o: OptionValues, cmd: Command) => run(['spec'], genFlags(cmd)));

gen
  .command('docs')
  .description('Generate only the docs HTML')
  .action((_o: OptionValues, cmd: Command) => run(['docs'], genFlags(cmd)));

gen
  .command('sdk')
  .description('Generate only the TypeScript SDK')
  .action((_o: OptionValues, cmd: Command) => run(['sdk'], genFlags(cmd)));

gen
  .command('all', { isDefault: true })
  .description('Generate spec, docs, and SDK')
  .action((_o: OptionValues, cmd: Command) => run(undefined, genFlags(cmd)));

interface CheckFlags {
  config?: string;
  diff?: boolean;
}

function printCheck(result: CheckResult, only: Artifact[] | undefined): void {
  const scope = only ? only.join(', ') : 'artifacts';
  if (result.clean) {
    console.log(`✓ ${scope} up to date (${String(result.checked.length)} files checked)`);
    return;
  }

  const count = result.drift.length;
  console.error(`✗ ${String(count)} generated file${count === 1 ? ' is' : 's are'} out of date.`);
  console.error('');
  for (const entry of result.drift) {
    console.error(`  ${entry.status.padEnd(8)}${entry.path}`);
  }
  for (const entry of result.drift) {
    if (entry.diff.length === 0) continue;
    console.error('');
    console.error(`--- ${entry.path} (committed)`);
    console.error(`+++ ${entry.path} (generated)`);
    for (const line of entry.diff) console.error(line);
  }
  console.error('');
  console.error(`Run \`sdkgen gen ${only?.join(' ') ?? 'all'}\` and commit the result.`);
  process.exitCode = 1;
}

async function runCheck(only: Artifact[] | undefined, flags: CheckFlags): Promise<void> {
  try {
    printCheck(await check({ configPath: flags.config, only, diff: flags.diff }), only);
  } catch (err) {
    fail(err);
  }
}

const checkCmd = program
  .command('check')
  .description('Fail if the committed artifacts differ from what generation would produce')
  .option('-c, --config <path>', 'path to config file')
  .option('--no-diff', 'list the stale files without showing their contents');

const checkFlags = (cmd: Command): CheckFlags => cmd.parent?.opts<CheckFlags>() ?? {};

checkCmd
  .command('spec')
  .description('Check only the OpenAPI spec')
  .action((_o: OptionValues, cmd: Command) => runCheck(['spec'], checkFlags(cmd)));

checkCmd
  .command('docs')
  .description('Check only the docs HTML')
  .action((_o: OptionValues, cmd: Command) => runCheck(['docs'], checkFlags(cmd)));

checkCmd
  .command('sdk')
  .description('Check only the TypeScript SDK')
  .action((_o: OptionValues, cmd: Command) => runCheck(['sdk'], checkFlags(cmd)));

checkCmd
  .command('all', { isDefault: true })
  .description('Check spec, docs, and SDK')
  .action((_o: OptionValues, cmd: Command) => runCheck(undefined, checkFlags(cmd)));

interface InitFlags {
  config?: string;
  entry?: string;
  routes?: string;
  force?: boolean;
}

program
  .command('init')
  .description('Scaffold sdkgen.config.ts and a side-effect-free entry module')
  .argument('[dir]', 'directory to scaffold into', '.')
  .option('-c, --config <path>', 'config filename to write', 'sdkgen.config.ts')
  .option('-e, --entry <path>', 'entry module to write', 'src/openapi.ts')
  .option('-r, --routes <path>', 'example route module to write', 'src/routes.ts')
  .option('-f, --force', 'overwrite files that already exist')
  .action(async (dir: string, opts: InitFlags) => {
    try {
      const result = await init({ dir, ...opts });
      for (const file of result.created) console.log(`✓ created  ${file}`);
      for (const file of result.kept) console.log(`· kept     ${file} (already present)`);
      console.log('');
      console.log('Next: npx sdkgen gen all');
    } catch (err) {
      fail(err);
    }
  });

interface ServeFlags {
  config?: string;
  port?: string;
}

program
  .command('serve')
  .description('Serve live docs built from the registry')
  .option('-c, --config <path>', 'path to config file')
  .option('-p, --port <port>', 'port', '4000')
  .action(async (opts: ServeFlags) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      fail(new Error(`Invalid --port "${opts.port ?? ''}": expected a port number.`));
      return;
    }
    try {
      await serve({ configPath: opts.config, port });
    } catch (err) {
      // Without this the rejection escapes `parseAsync` as an unhandled
      // rejection and prints a raw stack trace.
      fail(err);
    }
  });

program.parseAsync(process.argv).catch(fail);

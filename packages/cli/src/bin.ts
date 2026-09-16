#!/usr/bin/env node
import { Command, type OptionValues } from 'commander';
import { generate, type Artifact } from './generate.js';
import { serve } from './serve.js';

const program = new Command();

program
  .name('sdkgen')
  .description('Generate OpenAPI spec, docs, and a typed TS SDK from an Express app');

interface GenFlags {
  config?: string;
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

async function run(only: Artifact[] | undefined, flags: GenFlags): Promise<void> {
  try {
    const result = await generate({ configPath: flags.config, only });
    if (result.specPath) console.log(`✓ spec   ${result.specPath}`);
    if (result.yamlPath) console.log(`✓ spec   ${result.yamlPath}`);
    if (result.docsPath) console.log(`✓ docs   ${result.docsPath}`);
    if (result.sdkDir) console.log(`✓ sdk    ${result.sdkDir}`);
  } catch (err) {
    fail(err);
  }
}

const gen = program
  .command('gen')
  .description('Generate artifacts')
  .option('-c, --config <path>', 'path to config file');

// The `-c/--config` flag lives on the parent `gen` command, so each subcommand
// reads its parent's options.
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

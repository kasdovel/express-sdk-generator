#!/usr/bin/env node
import { Command } from 'commander';
import { generate, type Artifact } from './generate.js';
import { serve } from './serve.js';

const program = new Command();

program
  .name('sdkgen')
  .description('Generate OpenAPI spec, docs, and a typed TS SDK from an Express app');

interface GenFlags {
  config?: string;
}

async function run(only: Artifact[] | undefined, flags: GenFlags): Promise<void> {
  try {
    const result = await generate({ configPath: flags.config, only });
    console.log(`✓ spec   ${result.specPath}`);
    if (result.docsPath) console.log(`✓ docs   ${result.docsPath}`);
    if (result.sdkDir) console.log(`✓ sdk    ${result.sdkDir}`);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const gen = program
  .command('gen')
  .description('Generate artifacts')
  .option('-c, --config <path>', 'path to config file');

gen
  .command('spec')
  .description('Generate only the OpenAPI spec')
  .action((_o, cmd) => run(['spec'], cmd.parent.opts()));

gen
  .command('docs')
  .description('Generate only the docs HTML')
  .action((_o, cmd) => run(['docs'], cmd.parent.opts()));

gen
  .command('sdk')
  .description('Generate only the TypeScript SDK')
  .action((_o, cmd) => run(['sdk'], cmd.parent.opts()));

gen
  .command('all', { isDefault: true })
  .description('Generate spec, docs, and SDK')
  .action((_o, cmd) => run(undefined, cmd.parent.opts()));

program
  .command('serve')
  .description('Serve live docs built from the registry')
  .option('-c, --config <path>', 'path to config file')
  .option('-p, --port <port>', 'port', '4000')
  .action((opts) =>
    serve({ configPath: opts.config, port: Number(opts.port) }),
  );

program.parseAsync(process.argv);

import { parseArgs, styleText } from 'node:util';
import { readPluginVersion } from './utils/paths.js';
import type { InstallOptions } from './commands/install.js';

const args = process.argv.slice(2);
const firstArg = args[0]?.toLowerCase() ?? '';
// If the first token is a flag (e.g. `npx llm-mem --provider claude`),
// treat the invocation as `install` with those flags. Help/version flags are
// handled directly so they don't get swallowed by the install path.
const HELP_OR_VERSION_FLAGS = new Set(['-h', '--help', '-v', '--version']);
const command =
  firstArg.startsWith('-') && !HELP_OR_VERSION_FLAGS.has(firstArg)
    ? 'install'
    : firstArg;

function printHelp(): void {
  const version = readPluginVersion();

  console.log(`
${styleText('bold', 'llm-mem')} v${version} — persistent memory for AI coding assistants

${styleText('bold', 'Install Commands')} (no Bun required):
  ${styleText('cyan', 'npx llm-mem')}                     Interactive install
  ${styleText('cyan', 'npx llm-mem install')}              Interactive install
  ${styleText('cyan', 'npx llm-mem install --ide <id>')}   Install for specific IDE
  ${styleText('cyan', 'npx llm-mem install --provider claude|gemini|openrouter')}   Set LLM provider non-interactively
  ${styleText('cyan', 'npx llm-mem install --model <id>')}   Set Claude model (when provider=claude)
  ${styleText('cyan', 'npx llm-mem install --no-auto-start')}   Skip worker auto-start at the end
  ${styleText('cyan', 'npx llm-mem install --disable-auto-memory')}   Explicitly disable Claude Code native auto-memory
  ${styleText('cyan', 'npx llm-mem repair')}                Repair runtime (re-runs Bun/uv setup and bun install in plugin cache)
  ${styleText('cyan', 'npx llm-mem update')}               Update to latest version
  ${styleText('cyan', 'npx llm-mem uninstall')}            Remove plugin and configs
  ${styleText('cyan', 'npx llm-mem version')}              Print version

${styleText('bold', 'Runtime Commands')} (requires Bun, delegates to installed plugin):
  ${styleText('cyan', 'npx llm-mem start')}                Start worker service
  ${styleText('cyan', 'npx llm-mem stop')}                 Stop worker service
  ${styleText('cyan', 'npx llm-mem restart')}              Restart worker service
  ${styleText('cyan', 'npx llm-mem status')}               Show worker status
  ${styleText('cyan', 'npx llm-mem doctor')}               Diagnose install/runtime health (bun, uv, worker)
  ${styleText('cyan', 'npx llm-mem telemetry status|enable|disable')}   Manage anonymous telemetry (on by default, opt-out)
  ${styleText('cyan', 'npx llm-mem server api-key create|list|revoke')}   Manage API keys
  ${styleText('cyan', 'npx llm-mem worker start|stop|restart|status')}    Worker compatibility aliases
  ${styleText('cyan', 'npx llm-mem search <query>')}       Search observations
  ${styleText('cyan', 'npx llm-mem adopt [--dry-run] [--branch <name>]')}    Stamp merged worktrees into parent project
  ${styleText('cyan', 'npx llm-mem cleanup [--dry-run]')}    Run one-time v12.4.3 pollution cleanup (or preview counts)
  ${styleText('cyan', 'npx llm-mem transcript watch')}     Start transcript watcher
  ${styleText('cyan', 'npx llm-mem antigravity-cli install|status|uninstall')}   Manage Antigravity CLI hooks + MCP config

${styleText('bold', 'IDE Identifiers')}:
  claude-code, cursor, opencode, openclaw,
  windsurf, codex-cli, copilot-cli, antigravity, goose,
  roo-code, warp
`);
}

function parseInstallOptions(argv: string[]): InstallOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      ide: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      'no-auto-start': { type: 'boolean' },
      'disable-auto-memory': { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });
  const flag = (name: string): string | undefined =>
    typeof values[name] === 'string' ? (values[name] as string) : undefined;
  const provider = flag('provider');
  if (provider !== undefined && provider !== 'claude' && provider !== 'gemini' && provider !== 'openrouter') {
    console.error(`Unknown --provider: ${provider}. Allowed: claude, gemini, openrouter`);
    process.exit(1);
  }
  return {
    ide: flag('ide'),
    provider: provider as InstallOptions['provider'],
    model: flag('model'),
    noAutoStart: values['no-auto-start'] === true,
    disableAutoMemory: values['disable-auto-memory'] === true,
  };
}

async function main(): Promise<void> {
  switch (command) {
    case '':
    case 'install': {
      const { runInstallCommand } = await import('./commands/install.js');
      await runInstallCommand(parseInstallOptions(args));
      break;
    }

    case 'repair': {
      const { runRepairCommand } = await import('./commands/install.js');
      await runRepairCommand();
      break;
    }

    case 'update':
    case 'upgrade': {
      const { runInstallCommand } = await import('./commands/install.js');
      await runInstallCommand();
      break;
    }

    case 'uninstall':
    case 'remove': {
      const { runUninstallCommand } = await import('./commands/uninstall.js');
      await runUninstallCommand();
      break;
    }

    case 'version':
    case '--version':
    case '-v': {
      console.log(readPluginVersion());
      break;
    }

    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }

    case 'start': {
      const { runStartCommand } = await import('./commands/runtime.js');
      runStartCommand();
      break;
    }
    case 'stop': {
      const { runStopCommand } = await import('./commands/runtime.js');
      runStopCommand();
      break;
    }
    case 'restart': {
      const { runRestartCommand } = await import('./commands/runtime.js');
      runRestartCommand();
      break;
    }
    case 'status': {
      const { runStatusCommand } = await import('./commands/runtime.js');
      runStatusCommand();
      break;
    }

    case 'doctor': {
      const { runDoctorCommand } = await import('./commands/doctor.js');
      await runDoctorCommand();
      break;
    }

    case 'telemetry': {
      const { runTelemetryCommand } = await import('./commands/telemetry.js');
      await runTelemetryCommand(args.slice(1));
      break;
    }

    case 'server': {
      // The Postgres/BullMQ server runtime was removed. The only surviving
      // 'server' subcommand is the SQLite-local API-key operability command.
      const { runServerApiKeyCommand } = await import('./commands/runtime.js');
      runServerApiKeyCommand(args.slice(1));
      break;
    }

    case 'antigravity-cli': {
      const { handleAntigravityCliCommand } = await import('../services/integrations/AntigravityCliHooksInstaller.js');
      const exitCode = await handleAntigravityCliCommand(args[1]?.toLowerCase(), args.slice(2));
      if (typeof exitCode === 'number') {
        process.exit(exitCode);
      }
      break;
    }

    case 'worker': {
      const sub = args[0]?.toLowerCase();
      let aliases: Map<string, () => void>;
      (async () => {
        const r = await import('./commands/runtime.js');
        aliases = new Map<string, () => void>([
          ['start', r.runStartCommand],
          ['stop', r.runStopCommand],
          ['restart', r.runRestartCommand],
          ['status', r.runStatusCommand],
        ]);
        const handler = aliases.get(sub ?? '');
        if (handler) {
          handler();
        } else {
          console.error(styleText('red', `Usage: npx llm-mem worker start|stop|restart|status`));
          process.exit(1);
        }
      })().catch((e) => {
        console.error(styleText('red', 'Fatal:'), (e as Error).message || e);
        process.exit(1);
      });
      return;
    }

    case 'search': {
      const { runSearchCommand } = await import('./commands/runtime.js');
      await runSearchCommand(args.slice(1));
      break;
    }

    case 'adopt': {
      const { runAdoptCommand } = await import('./commands/runtime.js');
      runAdoptCommand(args.slice(1));
      break;
    }

    case 'cleanup': {
      const { runCleanupCommand } = await import('./commands/runtime.js');
      runCleanupCommand(args.slice(1));
      break;
    }

    case 'transcript': {
      const subCommand = args[1]?.toLowerCase();
      if (subCommand === 'watch') {
        const { runTranscriptWatchCommand } = await import('./commands/runtime.js');
        runTranscriptWatchCommand();
      } else {
        console.error(styleText('red', `Unknown transcript subcommand: ${subCommand ?? '(none)'}`));
        console.error(`Usage: npx llm-mem transcript watch`);
        process.exit(1);
      }
      break;
    }

    default: {
      console.error(styleText('red', `Unknown command: ${command}`));
      console.error(`Run ${styleText('bold', 'npx llm-mem --help')} for usage information.`);
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(styleText('red', 'Fatal error:'), error.message || error);
  process.exit(1);
});

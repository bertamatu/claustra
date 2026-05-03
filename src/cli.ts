import { Command } from 'commander';
import path from 'node:path';
import { loadConfig } from './config.js';
import { findTsConfig, findNextVersion, buildProgram } from './scanner/project.js';
import { buildModuleGraph } from './scanner/module-graph.js';
import { classifyBoundaries } from './scanner/boundary.js';
import { rules } from './rules/index.js';
import { terminalReporter } from './reporters/terminal.js';
import { jsonReporter } from './reporters/json.js';
import { githubReporter } from './reporters/github.js';
import { logger } from './utils/logger.js';
import { matchesAnyGlob } from './utils/glob.js';
import type { Finding, ProjectContext } from './rules/types.js';
import { writeFileSync } from 'node:fs';

const program = new Command();

program
  .name('claustra')
  .description('Audits Next.js App Router projects for server/client boundary violations.')
  .version('1.0.1')
  .argument('[path]', 'project root to scan', '.')
  .option('--config <file>', 'path to config file (default: .claustra.json)')
  .option('--reporter <type>', 'output format: terminal | json | github', 'terminal')
  .option('--severity <level>', 'minimum severity to fail: critical | high | medium | low', 'high')
  .option('--rules <ids>', 'comma-separated rule IDs to run (e.g. a01,d01)')
  .option('--json-output <path>', 'write findings JSON to a file')
  .action(async (scanPath: string, opts: {
    config?: string;
    reporter: string;
    severity: string;
    rules?: string;
    jsonOutput?: string;
  }) => {
    try {
      const rootDir = path.resolve(scanPath);
      const config = loadConfig(rootDir, opts.config);

      if (opts.rules) {
        const allowedIds = new Set(opts.rules.split(',').map((r) => r.trim()));
        for (const id of Object.keys(config.rules)) {
          if (!allowedIds.has(id)) config.rules[id] = 'off';
        }
      }

      logger.info(`scanning ${rootDir}`);

      const tsConfigPath = findTsConfig(rootDir);
      const nextVersion = findNextVersion(rootDir);
      const { program: tsProgram, checker } = buildProgram(tsConfigPath);
      const moduleGraph = buildModuleGraph(tsProgram);
      const boundaryMap = classifyBoundaries(tsProgram, moduleGraph);

      const ctx: ProjectContext = {
        rootDir,
        tsConfigPath,
        program: tsProgram,
        checker,
        moduleGraph,
        boundaryMap,
        nextVersion,
        config,
      };

      const enabledRules = rules.filter((r) => (config.rules[r.id] ?? 'off') !== 'off');

      const allFindings: Finding[] = [];
      await Promise.all(
        enabledRules.map(async (rule) => {
          const findings = await rule.run(ctx);
          allFindings.push(...findings);
        }),
      );

      // Apply user-configured ignore globs to finding paths.
      const filteredFindings =
        config.ignore.length > 0
          ? allFindings.filter((f) => !matchesAnyGlob(f.file, config.ignore))
          : allFindings;

      const SEVERITY_ORDER: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };

      filteredFindings.sort((a, b) => {
        const sDiff = (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4);
        if (sDiff !== 0) return sDiff;
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        return a.line - b.line;
      });

      if (opts.jsonOutput) {
        writeFileSync(opts.jsonOutput, JSON.stringify({ findings: filteredFindings }, null, 2));
      }

      if (opts.reporter === 'json') {
        jsonReporter(filteredFindings);
      } else if (opts.reporter === 'github') {
        githubReporter(filteredFindings);
      } else {
        terminalReporter(filteredFindings);
      }

      const minSeverityOrder = SEVERITY_ORDER[opts.severity] ?? 1;
      const hasBlockingFindings = filteredFindings.some(
        (f) => (SEVERITY_ORDER[f.severity] ?? 4) <= minSeverityOrder,
      );

      process.exit(hasBlockingFindings ? 1 : 0);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
  });

program.parse();

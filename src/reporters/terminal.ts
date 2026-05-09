import pc from 'picocolors';
import type { Finding } from '../rules/types.js';

const SEVERITY_ICON: Record<string, string> = {
  critical: pc.red('✖ critical'),
  high: pc.yellow('⚠ high    '),
  medium: pc.cyan('● medium  '),
  low: pc.dim('○ low     '),
};

export const terminalReporter = (findings: Finding[]): void => {
  if (findings.length === 0) {
    console.log(pc.green('claustra: 0 findings'));
    return;
  }

  const counts: Record<string, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const fileSet = new Set<string>();

  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    fileSet.add(f.file);
  }

  console.log(
    `\nclaustra found ${pc.bold(String(findings.length))} ${findings.length === 1 ? 'issue' : 'issues'} in ${fileSet.size} ${fileSet.size === 1 ? 'file' : 'files'}\n`,
  );

  for (const finding of findings) {
    const loc = pc.dim(`${finding.file}:${finding.line}`);
    console.log(`  ${SEVERITY_ICON[finding.severity]}  ${loc}`);
    console.log(`    ${pc.bold(finding.ruleId.toUpperCase())} - ${finding.message}`);
    if (finding.detail) {
      for (const line of finding.detail.split('\n')) {
        console.log(`    ${line}`);
      }
    }
    if (finding.suggestion) {
      console.log(`    ${pc.green('→')} ${finding.suggestion}`);
    }
    if (finding.importChain && finding.importChain.length > 0) {
      console.log(`    ${pc.dim('Import chain: ' + finding.importChain.join(' → '))}`);
    }
    console.log();
  }

  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');

  console.log(`${findings.length} ${findings.length === 1 ? 'issue' : 'issues'}: ${summary}`);
  console.log(pc.dim('Run with --reporter=json for machine-readable output.'));
};

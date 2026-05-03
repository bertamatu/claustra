import type { Finding } from '../rules/types.js';

const LEVEL: Record<string, string> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'notice',
};

export const githubReporter = (findings: Finding[]): void => {
  for (const f of findings) {
    const level = LEVEL[f.severity] ?? 'notice';
    const msg = [f.message, f.suggestion ? `Fix: ${f.suggestion}` : '']
      .filter(Boolean)
      .join(' ');
    console.log(
      `::${level} file=${f.file},line=${f.line},col=${f.column},title=${f.ruleId}::${msg}`,
    );
  }
};

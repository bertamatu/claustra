import type { Rule } from './types.js';
import a01 from './a01-server-only-in-client.js';
import a02 from './a02-rsc-pattern-misuse.js';
import d01 from './d01-hydration-risks.js';
import d02 from './d02-caching-dynamic.js';

export const rules: Rule[] = [a01, a02, d01, d02];

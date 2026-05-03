import type { Rule } from './types.js';
import a01 from './a01-server-only-in-client.js';
import a02 from './a02-rsc-pattern-misuse.js';
import b01 from './b01-non-serializable-props.js';
import c01 from './c01-unvalidated-server-actions.js';
import c02 from './c02-unauthorized-server-actions.js';
import d01 from './d01-hydration-risks.js';
import d02 from './d02-caching-dynamic.js';

export const rules: Rule[] = [a01, a02, b01, c01, c02, d01, d02];

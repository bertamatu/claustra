import type { Rule } from './types.js';
import a01 from './a01-server-only-in-client.js';
import a02 from './a02-rsc-pattern-misuse.js';
import a03 from './a03-env-public-secret.js';
import a04 from './a04-unawaited-params.js';
import b01 from './b01-non-serializable-props.js';
import b03 from './b03-browser-storage.js';
import b02 from './b02-server-data-leakage.js';
import c01 from './c01-unvalidated-server-actions.js';
import c03 from './c03-webhook-verify.js';
import c04 from './c04-route-handler-ssrf.js';
import c05 from './c05-middleware-coverage.js';
import c02 from './c02-unauthorized-server-actions.js';
import d01 from './d01-hydration-risks.js';
import d02 from './d02-caching-dynamic.js';
import d03 from './d03-use-cache-request-scoped.js';

export const rules: Rule[] = [a01, a02, a03, a04, b01, b02, b03, c01, c02, c03, c04, c05, d01, d02, d03];

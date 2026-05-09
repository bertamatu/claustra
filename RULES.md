# claustra Rules — Source of Truth

> Every rule claustra enforces traces back to an authoritative source: official Next.js documentation, official React documentation, a published security advisory, or widely-adopted community standards. This document is both the spec for rule authors and the trust statement for users.

If a rule cannot point to a real source on this page, it does not ship. No exceptions.

---

## How to read this document

Each rule below has the same structure:

- **What it checks** — plain-English description of the pattern claustra detects
- **Severity** — critical / high / medium / low
- **Why it's a real problem** — the actual consequence (data leak, runtime error, security hole)
- **Authoritative sources** — direct links to the official docs or advisories that establish this as a real concern
- **Bad example** — minimal code that triggers the rule
- **Fixed example** — the recommended way to write it
- **Detection mechanism** — how claustra finds it (AST / module graph / type checker / data flow)
- **Known limitations** — false positive/negative considerations

Every claustra finding in the terminal includes a `Source: <url>` line linking back to the relevant section here.

---

## Template — for adding new rules in v2+

```markdown
## [ID] — [Short name]

**What it checks:** [one sentence, plain English]
**Severity:** [critical/high/medium/low]
**Detection:** [AST / module graph / type checker / data flow]
**Applies to:** [Next.js versions]

### Why it's a real problem
[2-3 sentences on the actual user-facing consequence]

### Authoritative sources
- [Source title 1](url) — [what part of the doc establishes the rule]
- [Source title 2](url) — [what part of the doc establishes the rule]

### Bad example
\`\`\`tsx
// app/path/to/file.tsx
[minimal failing code]
\`\`\`

### Fixed example
\`\`\`tsx
// app/path/to/file.tsx
[corrected code]
\`\`\`

### Known limitations
- [false positive case]
- [false negative case]
- [version-specific behavior]
```

---

## A1 — Server-only code reachable from client tree

**What it checks:** A file marked `'use client'` (or any file it transitively imports) reaches a module that should never run in the browser — Node built-ins like `fs`, server-only database clients like `@prisma/client`, or non-public environment variables.

**Severity:** critical
**Detection:** module graph traversal
**Applies to:** Next.js 13.4+ App Router, all React frameworks using RSC

### Why it's a real problem

Anything reachable from a `'use client'` file gets bundled into the JavaScript shipped to the browser. If a database client, secret, or filesystem helper makes it across that line, you've leaked it to every visitor's browser. Next.js will sometimes catch this at build time, but not always — particularly when the offending import is conditional, dynamic, or routed through a barrel file.

### Authoritative sources

- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — establishes that `'use client'` declares "a boundary between the Server and Client module graphs," and that "once a file is marked with 'use client', all its imports and child components are considered part of the client bundle"
- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — under "Data Access Layer," recommends verifying that "database packages and environment variables are not imported outside the Data Access Layer"
- [Next.js — Server-only docs](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning) — describes the `server-only` package as the explicit guardrail this rule enforces statically

### Bad example

```tsx
// lib/db.ts
import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();
export const getApiKey = () => process.env.STRIPE_SECRET_KEY;

// components/UserCard.tsx
'use client';
import { getApiKey } from '../lib/db'; // ❌ pulls Prisma + secret into client bundle
export const UserCard = () => <div>{getApiKey()}</div>;
```

### Fixed example

```tsx
// lib/db.ts
import 'server-only';
import { PrismaClient } from '@prisma/client';
export const db = new PrismaClient();

// app/users/page.tsx (Server Component)
import { db } from '@/lib/db';
import { UserCard } from '@/components/UserCard';

export default async function Page() {
  const user = await db.user.findFirst();
  return <UserCard name={user.name} />; // pass only safe data
}

// components/UserCard.tsx
'use client';
export const UserCard = ({ name }: { name: string }) => <div>{name}</div>;
```

### Known limitations

- Conditional dynamic imports (`if (cond) await import('fs')`) inside a client file aren't always reachable; we flag the worst case
- Barrel re-exports may show longer import chains than necessary in the output
- Custom server-only packages can be added via the `extraServerOnlyModules` config option

---

## A2 — RSC pattern misuse

**What it checks:** A `'use client'` file uses server-only APIs (`cookies()`, `headers()`, top-level `await`, `async function Component`), or a server file uses client-only APIs (`useState`, `useEffect`, event handlers on intrinsic elements). Also flags misplaced directives.

**Severity:** high
**Detection:** AST pattern matching
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

These patterns are explicit errors per the React and Next.js specs. Some throw at build time, others at runtime, and some — like async client components — silently produce broken behavior. Catching them statically saves a debugging session.

### Authoritative sources

- [Next.js — `use client` directive](https://nextjs.org/docs/app/api-reference/directives/use-client) — defines what's allowed in client components and where the directive must appear
- [Next.js — `use server` directive](https://nextjs.org/docs/app/api-reference/directives/use-server) — defines directive placement rules
- [Next.js — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — lists the client-only APIs (state, event handlers, lifecycle) and the server-only APIs

### Bad example

```tsx
// components/Counter.tsx
'use client';
import { cookies } from 'next/headers'; // ❌ server-only API in client file

export default function Counter() {
  const session = cookies().get('session'); // ❌ won't work in browser
  return <button onClick={() => {}}>+</button>;
}

// app/dashboard/page.tsx
import { useState } from 'react'; // ❌ hook in server component

export default function Dashboard() {
  const [count, setCount] = useState(0); // ❌ runtime error
  return <button onClick={() => setCount(count + 1)}>{count}</button>; // ❌ event handler
}
```

### Fixed example

```tsx
// components/Counter.tsx
'use client';
import { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}

// app/dashboard/page.tsx (server component)
import { cookies } from 'next/headers';
import Counter from '@/components/Counter';

export default async function Dashboard() {
  const session = (await cookies()).get('session');
  return (
    <div>
      <p>Welcome {session?.value}</p>
      <Counter />
    </div>
  );
}
```

### Known limitations

- Some custom hooks can be called in non-render contexts; we only flag clear cases
- Async server components are valid; we only flag async *client* components

---

## A3 — Secret pattern in NEXT_PUBLIC_ variable

**What it checks:** A `NEXT_PUBLIC_*` env variable — declared in `.env`, `.env.local`, `.env.production`, `.env.development`, or the `env` block of `next.config.{js,ts,mjs,cjs}` — holds a value that matches a known provider secret format (Stripe `sk_*`/`rk_*`, OpenAI `sk-*`, Anthropic `sk-ant-*`, AWS access key `AKIA…`, GitHub PAT `ghp_*`) or a generic high-entropy base64/hex string of ≥24 characters.

**Severity:** critical
**Detection:** env-file parser + AST walk over `next.config.*` for object-literal `env: { ... }` blocks
**Applies to:** Next.js 13.4+ App Router (any version that honours the `NEXT_PUBLIC_` inlining contract)

### Why it's a real problem

Next.js inlines every `NEXT_PUBLIC_`-prefixed variable into the JavaScript bundle it sends to every visitor's browser. That contract is intentional and load-bearing — it's how client code reads public configuration like API base URLs and feature flags. But the same contract makes the prefix the single most dangerous typo in an App Router project: rename a real secret like `STRIPE_SECRET_KEY` to `NEXT_PUBLIC_STRIPE_SECRET_KEY` (intentionally to "fix a build error", or accidentally via a `.env.example` copy-paste) and the secret is now world-readable in View Source. A02 catches the *read* from client code; A3 catches the *value itself* before any client ever loads the bundle.

The redaction rule for this check is non-negotiable: claustra never prints the literal value of a flagged env variable. The finding identifies the key, the file, the line, and which pattern matched — nothing else. This avoids re-leaking the secret into terminal scrollback, CI logs, JSON artifacts, or PR annotations.

### Authoritative sources

- [Next.js — Environment variables: bundling for the browser](https://nextjs.org/docs/app/guides/environment-variables#bundling-environment-variables-for-the-browser) — *"any variable prefixed with `NEXT_PUBLIC_` will be inlined into the JavaScript bundle that is sent to the browser. This inlining occurs at build time"*. Also: *"In order to keep server-only secrets safe, environment variables are evaluated at build time, so only environment variables actually used will be included."* — i.e. the prefix is the *only* gatekeeper.
- [Stripe — API keys](https://docs.stripe.com/keys) — establishes the `pk_*` (publishable, safe) vs `sk_*`/`rk_*` (secret, must never appear client-side) split this rule encodes.
- [OpenAI — Best practices for API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety) — establishes that the `sk-*` API key format is server-side only.
- [Anthropic — API keys](https://docs.anthropic.com/en/api/getting-started) — establishes the `sk-ant-*` format and its server-only handling.
- [AWS — Managing access keys for IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html) — defines the `AKIA…` access-key-ID format.
- [GitHub — Personal access token formats](https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/) — defines the `ghp_*` token prefix.

### Bad example

```bash
# .env.local
NEXT_PUBLIC_STRIPE_KEY=sk_live_<24+ alphanumerics>     # ❌ secret in NEXT_PUBLIC_
NEXT_PUBLIC_OPENAI=sk-proj-<long opaque key>           # ❌ inlined to browser bundle
```

```ts
// next.config.ts
export default {
  env: {
    NEXT_PUBLIC_RK: 'rk_live_<24+ alphanumerics>',     // ❌ Stripe restricted key
  },
};
```

### Fixed example

```bash
# .env.local — secrets stay server-side, no NEXT_PUBLIC_ prefix
STRIPE_SECRET_KEY=sk_live_<24+ alphanumerics>
OPENAI_API_KEY=sk-proj-<long opaque key>

# Genuinely public values keep the prefix
NEXT_PUBLIC_STRIPE_PK=pk_test_<publishable key>
NEXT_PUBLIC_API_URL=https://api.example.com
```

```ts
// Server-only read
import 'server-only';
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

### Known limitations

- Pattern coverage is limited to the providers most commonly mishandled in NEXT_PUBLIC_; novel/private API key formats below the entropy threshold won't trigger.
- Generic high-entropy detection uses Shannon entropy ≥4.5 bits/char on strings ≥24 chars matching a base64/hex character set — short or low-entropy secrets (e.g. 16-character HMAC keys) won't trigger.
- Stripe publishable keys (`pk_test_*`/`pk_live_*`) and any value matching `pk-*` are intentionally not flagged — they are designed to ship to the browser.
- Placeholder values (`<your-key-here>`, `xxx…`, `changeme`, `${VAR}`, empty) are skipped to avoid noise on `.env.example`-style files.
- Values that look like URLs, UUIDs, or hostnames are skipped.
- Only the literal string assigned in a `next.config.*` `env: {…}` block is inspected; values constructed dynamically (concatenation, function calls) are out of scope for the static check.
- Rotating a leaked key is the *only* fix. The rule's suggestion text reflects this.

---

## B1 — Non-serializable props from server to client

**What it checks:** A server component passes a function (other than a Server Action), class instance, `Map`, `Set`, `Symbol`, or `BigInt` as a prop to a client component.

**Severity:** high
**Detection:** TypeScript type checker
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

React must serialize props when crossing the server/client boundary so they can be sent over the network. Non-serializable values either throw at render time or are silently dropped, leading to "why is this prop undefined" debugging sessions.

### Authoritative sources

- [Next.js — `use client` directive: Serializable props](https://nextjs.org/docs/app/api-reference/directives/use-client) — explicitly states "the props of the Client Components must be serializable. This means the props need to be in a format that React can serialize when sending data from the server to the client" and shows the exact `onClick` example as the canonical bad pattern
- [React — Server Components docs](https://react.dev/reference/rsc/use-client) — defines what's serializable across the wire

### Bad example

```tsx
// app/page.tsx (server component)
import { Counter } from './Counter';

export default function Page() {
  const handleClick = () => console.log('click'); // ❌ function, not serializable
  return <Counter onClick={handleClick} startDate={new Date()} />;
}

// app/Counter.tsx
'use client';
type Props = { onClick: () => void; startDate: Date };
export const Counter = ({ onClick, startDate }: Props) => (
  <button onClick={onClick}>{startDate.toString()}</button>
);
```

### Fixed example

```tsx
// app/actions.ts
'use server';
export const logClick = async () => { /* ... */ };

// app/page.tsx (server component)
import { Counter } from './Counter';
import { logClick } from './actions';

export default function Page() {
  return <Counter onClick={logClick} startDateIso={new Date().toISOString()} />;
}

// app/Counter.tsx
'use client';
type Props = { onClick: () => Promise<void>; startDateIso: string };
export const Counter = ({ onClick, startDateIso }: Props) => (
  <button onClick={() => onClick()}>{new Date(startDateIso).toString()}</button>
);
```

### Known limitations

- Functions defined as Server Actions (with `'use server'`) ARE allowed; we exclude them
- `children` prop is allowed to contain anything (React handles it)
- `Promise` is allowed (RSC supports it); we don't flag
- `Date` is technically serializable but causes hydration drift — emitted as warning, not error

---

## B2 — Server data leakage to client

**What it checks:** A server component passes sensitive-looking data — props named like `password`/`token`/`secret`, spread props, or whole database query results — across the boundary to a client component.

**Severity:** critical
**Detection:** TypeScript type checker
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

Anything passed as a prop to a client component ends up in the HTML and JS sent to the browser. If a backend developer passes `<UserProfile user={user} />` and the `user` object includes `passwordHash` or `stripeCustomerId`, those fields are now visible in the page source. This is the most common form of accidental data exposure in App Router apps.

### Authoritative sources

- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — under "Auditing": *"`use client` files. Are the Component props expecting private data? Are the type signatures overly broad?"* This rule is the static enforcement of that exact audit step.
- [Next.js — `use server` directive](https://nextjs.org/docs/app/api-reference/directives/use-server) — *"Server Function return values are serialized and sent to the client. Only return data the UI needs, not raw database records."* This applies equally to Server Component → Client Component prop passing.
- [Next.js — Data Security guide](https://nextjs.org/docs/app/guides/data-security) — the canonical guide on this concern

### Bad example

```tsx
// app/profile/page.tsx (server component)
import { db } from '@/lib/db';
import { ProfileCard } from './ProfileCard';

export default async function Page() {
  const user = await db.user.findUnique({ where: { id: '...' } });
  // ❌ user includes passwordHash, stripeCustomerId, internalNotes, etc.
  return <ProfileCard user={user} />;
}

// Worse: spread props
// return <ProfileCard {...user} />;
```

### Fixed example

```tsx
// app/profile/page.tsx (server component)
import { db } from '@/lib/db';
import { ProfileCard } from './ProfileCard';

export default async function Page() {
  const user = await db.user.findUnique({
    where: { id: '...' },
    select: { id: true, name: true, avatarUrl: true }, // ✅ only public fields
  });
  return <ProfileCard user={user} />;
}
```

### Known limitations

- Catches deterministic cases: sensitive prop names, spread props, and Prisma/Mongoose query results passed as props without `select`/`omit`
- A type that doesn't match any of these patterns but still contains private fields (e.g. a manually-typed object) will not be flagged — out of scope for the static check

---

## B3 — Sensitive value written to browser storage

**What it checks:** A `'use client'` file (or any module reachable from one through the import graph) writes to `localStorage.setItem` / `sessionStorage.setItem` (or the `window.<storage>.setItem` form) where the static key string matches a token/auth/credential/session pattern, or the value is `JSON.stringify(<identifier>)` for an identifier whose name suggests PII (`user`, `profile`, `account`, `session`).

**Severity:** high (downgraded to medium when the value is wrapped in a `secure*`/`encrypted*`-named function not in claustra's recognized helper list).
**Detection:** module-graph reachability + AST pattern matching
**Applies to:** Next.js 13.4+ App Router (any browser-runtime React code)

### Why it's a real problem

`localStorage` and `sessionStorage` are readable by any JavaScript executing on the same origin — including XSS payloads, third-party scripts loaded for analytics or chat, malicious browser extensions, and any future first-party code. There is no `httpOnly` equivalent for browser storage. Storing an auth token there turns one stored-XSS into a full account takeover, because the attacker's payload can read the token and exfiltrate it. Storing a serialized user/profile/account object there turns the storage layer into a permanent PII liability that survives logout and tab-close, gets backed up to disk, and shows up in DevTools for anyone who picks up the laptop.

### Authoritative sources

- [OWASP Cheat Sheet — HTML5 Security: Local Storage](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage) — *"Do not store sensitive data such as session identifiers or PII in local storage."* The canonical recommendation against this pattern.
- [OWASP — Session Management Cheat Sheet: Web Storage API](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-storage-api) — *"It is recommended not to store any sensitive information using these mechanisms."* Specifically discourages session tokens.
- [MDN — Window: localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) — *"localStorage is similar to sessionStorage … both are subject to the same-origin policy"* and *"is accessible to any JavaScript code running on the same origin."*
- [Auth0 — Token Storage best practices](https://auth0.com/docs/secure/security-guidance/data-security/token-storage) — *"Do not store tokens in browser local storage … browser local storage is accessible by any JavaScript running on the page."* The standard guidance from a major auth provider.

### Bad example

```tsx
// components/LoginForm.tsx
'use client';

export const LoginForm = () => {
  const handleLogin = async (form: FormData) => {
    const res = await fetch('/api/login', { method: 'POST', body: form });
    const { token, user } = await res.json();
    localStorage.setItem('auth_token', token);                   // ❌ XSS-readable
    localStorage.setItem('cachedProfile', JSON.stringify(user)); // ❌ PII in storage
  };
  // …
};
```

### Fixed example

```tsx
// components/LoginForm.tsx
'use client';
import { useUser } from '@/lib/user-context';

export const LoginForm = () => {
  const { setUser } = useUser();
  const handleLogin = async (form: FormData) => {
    // Server sets the auth token as an httpOnly cookie on /api/login.
    // The browser sends it automatically on subsequent requests; JS
    // cannot read it.
    const res = await fetch('/api/login', { method: 'POST', body: form });
    const { user } = await res.json();
    setUser(user); // ✅ in-memory React state — gone on tab close
  };
  // …
};
```

### Known limitations

- Detects only static string keys. A dynamic key (`localStorage.setItem(keyVar, …)`) is conservatively not flagged on key heuristics; if the value is a `JSON.stringify` of a suspect identifier it still fires.
- Detects only direct `setItem` calls on `localStorage` / `sessionStorage` / `window.<storage>`. Aliased references (`const ls = localStorage; ls.setItem(…)`) and `globalThis.<storage>` are out of scope for v1.
- The PII detector matches `JSON.stringify(<identifier>)` only — `JSON.stringify({ user })` shorthand or `JSON.stringify(buildPayload())` are not currently recognized.
- The "recognized encryption helper" list is intentionally conservative; see `src/utils/known-helpers.ts`. A wrapper that performs real authenticated encryption but is not on the list will produce a medium-severity warning rather than full suppression.
- `getItem` reads are never flagged — only writes.

---

## C1 — Server Actions without input validation

**What it checks:** A function with `'use server'` directive uses its parameters in a database write, filesystem write, or external `fetch` call without first passing them through a validation library (Zod, Valibot, Yup, ArkType, TypeBox) or manual type guard.

**Severity:** critical
**Detection:** forward taint analysis
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

Server Actions are public HTTP POST endpoints. Anyone can call them with any payload — TypeScript types are erased at runtime and provide no protection. Without validation, an attacker can send arbitrary data to your database. This is the single most common Server Action vulnerability and is directly related to the December 2025 RSC RCE (CVE-2025-55182) class of bugs.

### Authoritative sources

- [Next.js — Data Security guide](https://nextjs.org/docs/app/guides/data-security) — *"You should always validate input from client, as they can be easily modified."* (Verbatim from the official docs.)
- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — *"those functions should always start by validating that the current user is allowed to invoke this action. Functions should also validate the integrity of each argument. This can be done manually or with a tool like zod."*
- [React — CVE-2025-55182 advisory](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components) — the highest-profile recent example of what unvalidated Server Functions enable
- [Next.js — Authentication guide](https://nextjs.org/docs/app/guides/authentication) — *"Treat Server Actions with the same security considerations as public-facing API endpoints"*

### Bad example

```tsx
// app/actions.ts
'use server';
import { db } from '@/lib/db';

export async function updateProfile(formData: FormData) {
  const name = formData.get('name'); // ❌ unknown type, unvalidated
  const userId = formData.get('userId'); // ❌ attacker-controlled
  await db.user.update({
    where: { id: userId as string },
    data: { name: name as string },
  });
}
```

### Fixed example

```tsx
// app/actions.ts
'use server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const Schema = z.object({
  name: z.string().min(1).max(100),
});

export async function updateProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const data = Schema.parse(Object.fromEntries(formData));
  await db.user.update({
    where: { id: session.user.id }, // ✅ from authenticated session, not form
    data: { name: data.name },
  });
}
```

### Known limitations

- Recognizes Zod (`Schema.parse`/`safeParse`), Valibot (free `parse(schema, value)`), Yup (`validateSync`/`validate`), ArkType (`assert`), TypeBox (`Check`)
- Unknown validator names produce a false positive — add the helper to your codebase under one of the recognized name patterns or rename to match
- `JSON.parse`, `Number()`, and similar built-ins are explicitly NOT counted as validators

---

## C2 — Server Actions without authorization

**What it checks:** A Server Action that performs a mutation (DB write, filesystem write, external API call) does not call any authorization helper (`auth()`, `getServerSession()`, Clerk's `currentUser()`, etc.) before the mutation.

**Severity:** high
**Detection:** data-flow analysis
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

Like C1, every Server Action is a public HTTP endpoint. Even with input validation, if you don't check *who* is calling, anyone can invoke it. Combined with knowledge of your app's action IDs (visible in the JS bundle), this enables unauthenticated mutations.

### Authoritative sources

- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — *"those functions should always start by validating that the current user is allowed to invoke this action"*
- [Next.js — Authentication guide](https://nextjs.org/docs/app/guides/authentication) — *"Ensure that any Server Actions called from these components also perform their own authorization checks, as client-side UI restrictions alone are not sufficient for security."*
- [Clerk — Server Actions guide](https://clerk.com/docs/reference/nextjs/app-router/server-actions) — establishes the standard auth pattern across the ecosystem

### Bad example

```tsx
// app/actions/delete-post.ts
'use server';
import { z } from 'zod';
import { db } from '@/lib/db';

const Schema = z.object({ postId: z.string() });

export async function deletePost(input: unknown) {
  const { postId } = Schema.parse(input); // ✅ validated
  await db.post.delete({ where: { id: postId } }); // ❌ no auth check
}
```

### Fixed example

```tsx
// app/actions/delete-post.ts
'use server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

const Schema = z.object({ postId: z.string() });

export async function deletePost(input: unknown) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const { postId } = Schema.parse(input);

  const post = await db.post.findUnique({ where: { id: postId } });
  if (post?.authorId !== session.user.id) throw new Error('Forbidden');

  await db.post.delete({ where: { id: postId } });
}
```

### Known limitations

- Recognizes NextAuth (`auth`, `getServerSession`), Clerk (`auth`, `currentUser`), Lucia, Better-Auth, plus middleware patterns (`next-safe-action`)
- Custom auth helpers are recognized via name patterns (`/^(verify|require|check|assert|guard).*?(Auth|Session|User|Permission|Role|Access)/i`)
- Read-only Server Actions don't require this check; we only flag mutations

---

## C3 — Webhook handler missing signature verification

**What it checks:** A Next.js Route Handler (`route.ts`/`route.js`) that looks like a webhook receiver — either its file path contains `/webhook/` or `/webhooks/` as a segment, or it imports from a known webhook SDK (`stripe`, `@octokit/webhooks`, `@octokit/webhooks-methods`, `svix`, `@clerk/backend`, `shopify-api-node`, `@vercel/webhooks`) — exports a `POST`/`PUT`/`PATCH` handler that reads the request body (`request.json()`/`text()`/`formData()`/`arrayBuffer()`/`blob()`) or performs a database write (`create`/`update`/`delete`/`upsert`/`insert`/`save`/`bulkWrite`/etc. on a non-builtin receiver) without anywhere in the function body calling a recognized signature verifier.

**Severity:** critical
**Detection:** AST pattern matching on Route Handler exports + recognized-verifier presence check
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

A webhook endpoint is a public HTTP POST that anyone on the internet can call. The provider sends a signature header (`Stripe-Signature`, `X-Hub-Signature-256`, `svix-signature`, etc.) computed over the raw request body using a shared secret; without verifying that signature, your handler has no way to distinguish a real provider event from a forged request. Forgery is not theoretical — the URL is in your logs, the payload shape is in the provider's public docs, and the secret needed to verify is the *only* thing standing between an attacker and arbitrary writes to your billing/auth/inventory state. December 2025 saw a wave of webhook-forgery exploits against e-commerce sites built without verification; the affected handlers all looked like the bad example below.

claustra treats the handler as verified if a recognized verifier (`stripe.webhooks.constructEvent`, `Webhook.verify`, `verify`, `constructEvent`, or any `verify*Webhook|Signature`-named helper) is called *anywhere* in the function body. This matches the canonical Stripe pattern, where `request.text()` must be called *before* the verifier (the verifier needs the raw bytes). Body reads and DB writes inside an `if (process.env.NODE_ENV === 'development')` (or `!== 'production'`) block are exempt from the verifier requirement, so a dev-mode bypass does not need to plug into a real signing secret.

### Authoritative sources

- [Stripe — Verify webhook signatures](https://docs.stripe.com/webhooks/signatures) — *"Stripe signs the webhook events it sends to your endpoints by including a signature in each event's `Stripe-Signature` header. This allows you to verify that the events were sent by Stripe, not by a third party."* The `constructEvent` SDK call is presented as the only correct way to consume the body.
- [GitHub — Securing webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) — *"Without a secret, you can't verify if a webhook delivery is genuinely from GitHub. … Anyone with the URL can send malicious webhook payloads."*
- [svix — Verifying webhooks](https://docs.svix.com/receiving/verifying-payloads/how) — *"For security reasons, it's important to verify that the request actually came from Svix. … Failing to do so can let attackers issue forged webhook calls."*
- [OWASP — Webhook security](https://owasp.org/www-project-api-security/) (API Security Top 10, BOLA / BFLA categories applied to provider-driven endpoints) — establishes that public callback URLs without server-side verification are a recurring class of authorization failure.

### Bad example

```ts
// app/api/webhooks/stripe/route.ts
import Stripe from 'stripe';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const event = await request.json();        // ❌ raw body parsed without verification
  await db.subscription.create(event.data);  // ❌ writes derived from forged payload
  return new Response('ok');
}
```

### Fixed example

```ts
// app/api/webhooks/stripe/route.ts
import Stripe from 'stripe';
import { db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature')!;
  const event = stripe.webhooks.constructEvent(
    body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
  await db.subscription.create({ id: (event.data.object as { id: string }).id });
  return new Response('ok');
}
```

### Known limitations

- The verifier check is presence-based: a recognized verifier called *anywhere* in the function counts. The rule does not currently model whether the verifier's output is actually used, or whether the verifier's input was the raw body. A handler that calls `verify(...)` with the wrong arguments will not be flagged.
- Free-function `verify` from `@octokit/webhooks-methods` is recognized by name alone. A user-defined function literally named `verify` that does nothing security-relevant will silence the rule on this handler. Prefer renaming custom verifiers to a shape like `verifyWebhookSignature` so intent is explicit.
- DB-write detection mirrors the conservative method-name set used by C1 (`create`/`update`/`delete`/`upsert`/etc., excluding `Object`/`Array`/`JSON`/etc. receivers). ORMs that use unusual mutation method names will not be flagged on the DB-write path; the body-read path still fires.
- Only `POST`, `PUT`, and `PATCH` exports are analyzed. Webhooks delivered as `GET` (rare) are out of scope.
- Reading the signature header (`request.headers.get('x-…-signature')`) is not by itself sufficient — the verifier function must be called.

---

## C4 — Route Handler fetches user-controlled URL without allowlist

**What it checks:** A Next.js Route Handler (`route.ts`/`route.js`) where a value derived from the request — `request.url`, `request.nextUrl.*`, `URL(request.url).searchParams.get(...)`, or the second-arg `params` object for dynamic segments — flows into a server-side outbound-request sink (`fetch`, `axios`/`got` and their `.get`/`.post`/etc. methods, `new Request`, `new ImageResponse({ src })`) without first passing through an allowlist check, a validator-named helper, or a hardcoded host context.

**Severity:** high
**Detection:** AST + intra-handler taint propagation
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

Server-side requests built from untrusted URL params are a textbook SSRF gadget. An attacker can point your server at internal services (`http://localhost`, `http://169.254.169.254/latest/meta-data/` for AWS instance metadata, your private subnets), at private files via `file:`/`gopher:`/`dict:` schemes, or at endpoints that respond differently to server-side vs public callers (cloud SSO consoles, internal admin panels). Even an "image proxy" or "OG renderer" handler — the most common motivating use case for this pattern — is an exploitable foothold without a host allowlist: in 2024–2025 several reported breaches at AI/CDN startups traced back to OG-image endpoints fetching arbitrary attacker-supplied URLs.

claustra accepts an outbound request as guarded if any of the following appears between source and sink: a call to a `validate*Url`/`check*Url`/`isAllowedUrl`/`allowList*Url` helper, an `<allowlist>.includes(...)` or `<regex>.test(...)` against the tainted value, an equality check against a string literal, a receiver-side `.startsWith` / `.endsWith` / `.includes` / `.match` call with a literal argument, or `new URL(tainted, ...)` (taken as evidence the developer is parsing the input to inspect its hostname). The rule also exempts hardcoded-host construction — `fetch(\`https://api.example.com/x?id=${id}\`)`, `\`https://...\` + tainted`, or `process.env.API_BASE + tainted` — where the request URL's authority is not attacker-influenceable.

### Authoritative sources

- [OWASP — Server-Side Request Forgery (SSRF)](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery) — *"In a Server-Side Request Forgery (SSRF) attack, the attacker can abuse functionality on the server to read or update internal resources. … The attacker can supply or modify a URL which the code running on the server will read or submit data to."*
- [OWASP API Security Top 10 — API7:2023 SSRF](https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/) — establishes URL-validation against an allowlist as the canonical mitigation for any API endpoint that fetches a client-supplied URL.
- [PortSwigger Web Security Academy — SSRF](https://portswigger.net/web-security/ssrf) — covers the cloud-metadata (`169.254.169.254`) and internal-port-scan attack patterns this rule is shaped against.
- [Next.js — Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route) — defines the `request: Request` / `{ params }` handler contract whose inputs this rule treats as untrusted.

### Bad example

```ts
// app/api/proxy/route.ts
export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const upstream = await fetch(target); // ❌ attacker controls full URL
  return new Response(await upstream.text());
}
```

### Fixed example

```ts
// app/api/proxy/route.ts
const ALLOWED_HOSTS = new Set(['images.example.com', 'cdn.example.com']);

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const parsed = new URL(target);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return new Response('forbidden', { status: 403 });
  }
  const upstream = await fetch(parsed);
  return new Response(await upstream.text());
}
```

### Known limitations

- Taint propagation is intra-handler only: a tainted value passed to a helper defined in a separate module is not followed into that module. If the helper performs the validation, the rule will still flag the call site unless the helper is named `validate*Url`/`check*Url`/etc.
- Sanitizer detection is presence-based: a single sanitizing use of a tainted symbol anywhere in the handler clears it for every sink. A handler that validates `target` once and then fetches *both* `target` and a second tainted variable will not flag the second fetch.
- The hardcoded-host exemption requires the host to be statically visible in the call site (string literal, template head, leftmost concat operand, `new URL(tainted, '<base>')`). Hosts read from a runtime variable other than `process.env.*` are conservatively treated as tainted.
- Sinks are limited to the recognized set: `fetch`, `axios`, `got` (free-call and `.method`), `new Request`, `new ImageResponse({ src })`. Custom HTTP clients (`http.request`, `undici.fetch`, project-internal wrappers) are not yet modeled.
- Only `route.ts`/`route.js`/`route.mjs`/`route.cjs` files (with `.tsx` variants) are analyzed. Server Actions and middleware are out of scope here — Server Action SSRF is partially covered by C1's untrusted-input check, and middleware SSRF is sufficiently rare to not warrant a dedicated rule.

---

## C5 — Sensitive route lacks middleware coverage and inline auth

**What it checks:** A Next.js App Router page or route handler that *looks* sensitive — its URL contains `/admin`, `/dashboard`, `/account`, `/settings`, or `/billing`; or its file lives inside an `(authenticated)` / `(protected)` / `(dashboard)` route group; or it's a route handler that exports `POST`/`PUT`/`PATCH`/`DELETE` or performs a DB/FS mutation — and is *not* protected by either (a) a `middleware.{ts,js}` whose `config.matcher` covers the URL **and** whose body calls a recognized auth helper, or (b) an `auth()`/`currentUser()`/`validateRequest()`/`verify*Auth`/etc. call inside the route file itself or in any ancestor `layout.tsx`.

**Severity:** high
**Detection:** AST + file-system analysis (path-to-regexp matcher modeling, ancestor-layout traversal)
**Applies to:** Next.js 13.4+ App Router

### Why it's a real problem

Authentication in Next.js App Router is split across three places: `middleware.ts` (runs before the route resolves), the route's own component or handler, and any ancestor `layout.tsx` (which executes for every descendant page). A common, hard-to-spot bug is the middleware/layout drift: a developer adds `/admin` pages, intends to protect them with `middleware.ts`, but forgets to add `/admin/:path*` to `config.matcher` — so the middleware never runs for those routes. Or they refactor a `layout.tsx` and remove the `auth()` call. Or they add a Stripe-billing endpoint at `/api/billing/create-customer` and forget that route handlers, unlike pages, don't inherit their parent layout's `auth()` call. In each case the route ships *publicly accessible* despite looking like it sits behind auth — and indexers, scrapers, and accidental linking will find it within hours.

claustra resolves coverage in the order Next.js does at runtime: middleware first (matcher must cover the URL *and* the middleware body must actually call a recognized auth helper, otherwise it's just rewrites/headers and not a security gate), then inline auth in the file, then `auth()` in any ancestor `layout.tsx`. Webhook handlers (under `/webhook(s)/` or calling a recognized C3 verifier) are explicitly exempt — they are intentionally unauthenticated and gated by signature instead.

### Authoritative sources

- [Next.js — Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware) — *"Middleware will be invoked for every route in your project … the matcher allows you to filter Middleware to run on specific paths."* Establishes that matcher gaps mean the middleware is bypassed for those routes.
- [Next.js — Authentication](https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-middleware-optional) — describes the layered model (middleware as optimistic check; the actual gate must live in the data-access layer or component) and warns against relying on middleware alone.
- [Next.js — How to Think About Security in Next.js](https://nextjs.org/blog/security-nextjs-server-components-actions) — *"Authorization should not be performed in middleware alone … verify on every request inside the data access layer."*
- [Clerk — Protecting routes](https://clerk.com/docs/references/nextjs/clerk-middleware) — `clerkMiddleware()` + `config.matcher` is the canonical pattern; missing matcher entries are the most common Clerk-on-App-Router misconfiguration in their support corpus.

### Bad example

```ts
// middleware.ts
import { auth } from '@/auth';
export default auth;
export const config = { matcher: ['/admin/:path*'] };

// app/dashboard/page.tsx — looks protected, isn't.
export default async function DashboardPage() {
  const data = await fetchUserPrivateData(); // ❌ public
  return <div>{data.email}</div>;
}
```

### Fixed example

```ts
// middleware.ts
import { auth } from '@/auth';
export default auth;
export const config = { matcher: ['/admin/:path*', '/dashboard/:path*'] };
```

…or protect inline:

```tsx
// app/dashboard/page.tsx
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');
  const data = await fetchUserPrivateData();
  return <div>{data.email}</div>;
}
```

### Known limitations

- Recognized auth helpers are name-based: `auth`, `getServerSession`, `getServerAuthSession`, `currentUser`, `validateRequest`, `getSession`, `getToken`, `clerkMiddleware`, `authMiddleware`, `withAuth`, plus the regex `^(verify|require|check|assert|guard).*?(Auth|Session|User|Permission|Role|Access)`. A custom auth helper named `protectAdmin` would NOT count — rename it to `requireAdminSession` (or similar) or add it to the project's `extraServerOnlyModules` config equivalent (TODO: a `c05.extraAuthHelpers` config knob is on the v2 list).
- The `(auth)` route group is intentionally NOT treated as sensitive, because Next.js's own examples use it for the *unauthenticated* sign-in/sign-up flow. Use `(authenticated)` / `(protected)` / `(dashboard)` for protected sub-trees if you want claustra to recognize them.
- Ancestor-layout coverage walks upward only inside the same `app/` tree. A page protected by middleware on a workspace re-export (e.g. middleware exported from a sibling package) is NOT recognized as covered — claustra reads only the project's own `middleware.{ts,js}`.
- Path-to-regexp parsing is a deliberate subset (literals, `:name`/`:name*`/`:name+`/`:name?`, raw `(...)` groups, the standard Next.js `((?!…).*)` negative-lookahead form). Unrecognized syntax is treated conservatively as "covers everything" to avoid false positives.
- `routeExportsMutatingMethod` recognizes only the standard HTTP method export names. A handler that re-exports a `POST` from another module is not flagged on the export-name path; the DB-write path will still fire.
- Pages Router, Remix, and other SSR frameworks are out of scope — App Router only.

---

## D1 — Hydration mismatch risks

**What it checks:** Render-scope expressions that produce different values on server vs client — `Date.now()`, `new Date()` without args, `Math.random()`, browser-only API reads, locale-dependent formatting without an explicit locale.

**Severity:** high
**Detection:** AST pattern matching
**Applies to:** all SSR React frameworks (Next.js App Router, Pages Router, Remix, etc.; v1 only ships App Router awareness)

### Why it's a real problem

When the server renders one value (e.g. `Math.random()` returning `0.42`) and the client re-renders a different one, React detects the mismatch during hydration and tears down the entire subtree, falling back to client-only rendering. The user sees a flash of wrong content, performance suffers, and the error is logged in production. The error message is notoriously vague.

### Authoritative sources

- [Next.js — Text content does not match server-rendered HTML](https://nextjs.org/docs/messages/react-hydration-error) — the official error reference page lists `Date()`, `typeof window`, browser APIs, and locale formatting as the canonical causes
- [React — `hydrateRoot` docs](https://react.dev/reference/react-dom/client/hydrateRoot) — describes hydration mismatches and the consequences
- [Next.js — Caching documentation](https://nextjs.org/docs/app/getting-started/caching-and-revalidating) — explicitly notes "operations like Math.random(), Date.now(), or crypto.randomUUID() produce different values each time they execute"

### Bad example

```tsx
// components/Clock.tsx
'use client';

export const Clock = () => (
  <div>
    Current time: {new Date().toLocaleString()} {/* ❌ locale + Date in render */}
    Session ID: {Math.random()} {/* ❌ different on server vs client */}
  </div>
);
```

### Fixed example

```tsx
// components/Clock.tsx
'use client';
import { useEffect, useState } from 'react';

export const Clock = () => {
  const [time, setTime] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    setTime(new Date().toLocaleString('en-US')); // ✅ explicit locale
    setSessionId(crypto.randomUUID()); // ✅ in effect, runs only on client
  }, []);

  return (
    <div>
      Current time: {time ?? 'Loading...'}
      Session ID: {sessionId ?? '...'}
    </div>
  );
};
```

### Known limitations

- Doesn't flag inside `useEffect`, event handlers, or callback props
- Doesn't flag elements with `suppressHydrationWarning`
- Does NOT catch external state changes (e.g., a CDN modifying HTML between server and client) — only what's statically visible in your code

---

## D2 — Caching and dynamic rendering surprises

**What it checks:** Routes that use `cookies()`, `headers()`, or other dynamic-forcing APIs while declaring static `revalidate`. `fetch()` calls without explicit cache directives in version-aware contexts. Mismatched `revalidate` between route and fetch.

**Severity:** medium
**Detection:** AST + version-aware analysis (reads `package.json`)
**Applies to:** Next.js 13.4+ App Router (behavior differs between Next 14 and 15+)

### Why it's a real problem

Caching defaults changed between Next.js 14 and 15 — Next 14 caches `fetch()` by default, Next 15 does not. Teams upgrading often see stale data or surprise dynamic rendering, blowing up bills on Vercel. Calls to `cookies()` or `headers()` silently force dynamic rendering, which can break ISR expectations.

### Authoritative sources

- [Next.js — Caching docs](https://nextjs.org/docs/app/building-your-application/caching) — *"Dynamic APIs like cookies and headers... will opt a route out of the Full Route Cache, in other words, the route will be dynamically rendered."*
- [Next.js — `fetch` API reference](https://nextjs.org/docs/app/api-reference/functions/fetch) — defines the per-version default caching behavior
- [Next.js 15 release notes](https://nextjs.org/blog/next-15) — documents the breaking change in default `fetch` caching
- [Next.js — `use cache` directive docs](https://nextjs.org/docs/app/api-reference/directives/use-cache) — the new caching model in Next 15+

### Bad example

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';

export const revalidate = 3600; // ❌ declares ISR

export default async function Page() {
  const session = (await cookies()).get('session'); // ❌ forces dynamic
  // The `revalidate = 3600` is silently ignored.
  // Every request renders dynamically. Vercel bill grows.
  const data = await fetch('https://api.example.com/data'); // ❌ no cache directive
  // In Next 14: cached by default. In Next 15: not cached. Behavior changes on upgrade.

  return <div>...</div>;
}
```

### Fixed example

```tsx
// app/dashboard/page.tsx
import { cookies } from 'next/headers';
import { Suspense } from 'react';

// No `export const revalidate` — this route is dynamic by design.

export default async function Page() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const session = (await cookies()).get('session');
  const data = await fetch('https://api.example.com/data', {
    cache: 'force-cache',                // ✅ explicit caching intent
    next: { revalidate: 60 },            // ✅ explicit revalidation
  });
  return <div>...</div>;
}
```

### Known limitations

- Reads Next.js version from `package.json`; behavior differs between major versions
- Doesn't flag intentional dynamic rendering (no `revalidate` declared) at error level — only as info
- Doesn't analyze runtime cache hit/miss behavior, only static patterns

---

## How sources stay current

Documentation, advisories, and best practices in this ecosystem change frequently. To prevent claustra from going stale:

1. **Quarterly review.** Every three months, re-verify each source link still resolves and the cited content is still present.
2. **Version awareness.** Several rules read the user's `package.json` to apply version-appropriate logic. When Next.js ships a major version, that path needs updating.
3. **Advisory subscriptions.** Maintainers should subscribe to:
   - [Next.js blog RSS](https://nextjs.org/feed.xml)
   - [React blog RSS](https://react.dev/rss.xml)
   - [GitHub Security Advisories for vercel/next.js](https://github.com/vercel/next.js/security/advisories)
   - [GitHub Security Advisories for facebook/react](https://github.com/facebook/react/security/advisories)
4. **CHANGELOG entries.** When a rule's logic changes due to a framework update, the CHANGELOG must cite the framework change that prompted it.

---

## What this document is NOT

- It is not a generic React or Next.js best-practices guide. It only documents what claustra checks.
- It is not legal or compliance advice. It is engineering guidance backed by framework docs.
- It is not exhaustive. There are many ways to write buggy Next.js code that claustra does not catch, by design — see "Out of scope" in `CONTRIBUTING.md`.

---

## Contribution policy for new rules

Before opening a PR for a new rule:

1. Find at least one *official* source (Next.js docs, React docs, or a CVE) that establishes the pattern as a real concern.
2. Write the section using the template at the top of this file.
3. Add at least 5 fixture tests under `tests/fixtures/<rule-id>/` covering both violations and non-violations.
4. Confirm the rule fits within "Guiding principles" in `CONTRIBUTING.md`. If the new rule isn't about the server/client boundary, it likely belongs in a different tool.
5. Open the PR with a link to the source(s) in the description.

Rules that ship without a section here will be rejected. No exceptions.

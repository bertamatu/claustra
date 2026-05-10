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

## A4 — Unawaited `params` or `searchParams` in Next.js 15+

**What it checks:** A page, layout, route handler, or `generateMetadata`/`generateStaticParams`/`generateViewport` export accesses a property on `params` or `searchParams`, destructures them without `await`, or passes them straight into another call — when the project is on Next.js 15 or later, where these arguments became Promises.

**Severity:** critical
**Detection:** AST + TypeScript symbol resolution. Scans `app/**/{page,layout,route,loading,error,not-found,template}.{ts,tsx,js,jsx}`, finds default exports + HTTP-method exports + `generate*` exports, walks each function for references to the bound `params`/`searchParams` symbol, and classifies the parent expression.
**Applies to:** Next.js 15 and 16. Skipped entirely when `node_modules/next/package.json` reports a major version below 15. If the version is unknown (no Next.js installed in the scanned project), the rule still runs — disable via `.claustra.json` if scanning a Next 14 project without `node_modules`.

### Why it's a real problem

In Next.js 15 the framework migrated `params`, `searchParams`, `cookies()`, and `headers()` from sync values to Promises. Existing code that read `params.slug` or destructured `const { slug } = params` did not break loudly: the property lookup happens on the Promise object (which has no `slug` key), and the binding silently resolves to `undefined`. Pages render with empty data; route handlers return content for the wrong record; `generateMetadata` produces titles like `undefined | My App`. TypeScript catches this when the Promise type flows in correctly — but in real-world migrations, the params type is often `any` (custom helper, untyped), or stuck on the old shape, and the bug ships.

The rule complements the framework's codemod: it catches the cases the codemod missed and the cases that arrive *after* the migration — every new page a developer writes that copies an older example.

### Authoritative sources

- [Next.js — Async Request APIs (RFC then upgrade guide)](https://nextjs.org/blog/next-15#async-request-apis-breaking-change) — the v15 release blog post announcing `params`, `searchParams`, `cookies`, `headers`, and `draftMode` as Promises.
- [Next.js — `params` and `searchParams` — page reference](https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional) — current API contract: `Promise<{ … }>` for both.
- [Next.js — `generateMetadata` reference](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#parameters) — confirms the same Promise shape for the metadata-generation entry point.
- [Next.js — Route Handlers context argument](https://nextjs.org/docs/app/api-reference/file-conventions/route#context-optional) — the `{ params }` second argument to `GET`/`POST`/etc. is now `{ params: Promise<…> }`.
- [React — `use()` reference](https://react.dev/reference/react/use) — the synchronous escape hatch for Client Components that receive a Promise prop.

### Bad example

```tsx
// app/[id]/page.tsx — Next 15
type Props = { params: Promise<{ id: string }> };

export default async function ItemPage({ params }: Props) {
  const id = params.id;            // ❌ property access on a Promise → undefined
  const { team } = params;         // ❌ destructure without await → team is undefined
  return <div>{id} / {team}</div>;
}
```

```ts
// app/api/[id]/route.ts — Next 15
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return new Response(params.id); // ❌ params is a Promise here
}
```

### Fixed example

```tsx
// app/[id]/page.tsx
type Props = { params: Promise<{ id: string }> };

export default async function ItemPage({ params }: Props) {
  const { id } = await params;     // ✅ resolve, then read
  return <div>{id}</div>;
}
```

```tsx
// app/[id]/page.tsx — Client Component variant uses React's use()
'use client';
import { use } from 'react';

export default function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);      // ✅ sync unwrap inside a Client Component
  return <div>{id}</div>;
}
```

### Known limitations

- Re-binds via the type checker are honored: `const params = await props.params; params.x` is recognized as safe because the second `params` resolves to a different symbol than the function parameter.
- Calls to `use(params)` are exempted regardless of where `use` was imported from. A user-defined helper named `use` would be a false negative; this is accepted to keep the React-19 path clean.
- Passing the Promise into another function (`doStuff(params)`) is flagged once at the call site, but the rule does not chase into the callee. A helper that consumes the Promise correctly will produce a single false positive.
- Whole-object signatures (`(props) => { props.params.x }`) are supported via property-access checks on the param symbol; one-hop only — `const p = props; p.params.x` will produce a false negative because the rule does not propagate aliases beyond the parameter symbol.
- The rule does not inspect the type annotation. A `params` typed as `{ id: string }` (Next 14 shape) inside a Next 15 project is flagged the same as a `Promise<…>` shape — the bug is identical at runtime once the framework upgrades.
- Fully skipped on Next.js 14 and earlier; if a project hasn't installed `next` yet (no `node_modules/next`), the rule runs and may produce findings on Next-14-shape code.

---

## A5 — `useFormStatus` co-located with `<form>` in the same component

**What it checks:** A component imports `useFormStatus` from `react-dom` and calls it in the same function body that also renders a `<form>` JSX element. The React 19 hook reads form state from a *parent* `<form>` ancestor — colocating it with the form makes the hook return `pending: false` permanently because the form is a sibling/descendant, not an ancestor.

**Severity:** medium
**Detection:** AST scan. For each source file, collect local binding names produced by `import { useFormStatus } from 'react-dom'` (honoring `as` aliases). For each function-like node in the file, walk its body without descending into nested function-likes and count (a) calls to a tracked binding name and (b) `<form>` JSX elements at the same scope. If both counts are non-zero, flag every hook call site in that scope.
**Applies to:** React 19+. Imports from `'react-dom'` are the gate; if the module specifier is anything else (a user helper that happens to share the name), the rule does nothing.

### Why it's a real problem

`useFormStatus` is the React 19 primitive that lets a button (or any descendant) read its parent form's pending/data/method/action state without prop drilling. The key word is *parent*: the hook walks up the React tree looking for the nearest `<form>` element, and only that form's state is visible. When the hook and the form sit in the same component, the form is not yet rendered when the hook is called — there is no parent form in scope — so the hook returns the default `{ pending: false, data: null, method: null, action: null }` forever. The submit button stays enabled, the spinner never shows, and the bug doesn't surface in TypeScript or in casual smoke testing because the form still works; only the *pending UI* is silently broken.

The fix is structural: extract the component that consumes the hook (typically a submit button or a status indicator) into its own component, render it as a *child* of the `<form>`, and let the hook walk up to find the form ancestor.

### Authoritative sources

- [React — `useFormStatus` reference](https://react.dev/reference/react-dom/hooks/useFormStatus) — *"`useFormStatus` will only return status information for a parent `<form>`. It will not return status information for any `<form>` rendered in that same component or children components."*
- [React — Forms guide](https://react.dev/reference/react-dom/components/form#display-a-pending-state-during-form-submission) — recommended SubmitButton extraction pattern.

### Bad example

```tsx
'use client';
import { useFormStatus } from 'react-dom';

export const InlineForm = () => {
  const { pending } = useFormStatus(); // ❌ no parent form in this scope
  return (
    <form action={save}>
      <input name="x" />
      <button type="submit" disabled={pending}>save</button>
    </form>
  );
};
```

### Fixed example

```tsx
'use client';
import { useFormStatus } from 'react-dom';

const SubmitButton = () => {
  const { pending } = useFormStatus(); // ✅ reads from the outer <form>
  return <button type="submit" disabled={pending}>save</button>;
};

export const Form = () => (
  <form action={save}>
    <input name="x" />
    <SubmitButton />
  </form>
);
```

### Known limitations

- The "same scope" check is per-function: nested function-like nodes are not descended into. This is intentional — a child component defined inline that calls `useFormStatus()` correctly reads from the outer form, so the rule must not pick up its hook call against the parent's form.
- A `<form>` rendered conditionally that's the parent of the hook call site at runtime (`{cond ? <form>...{useFormStatus call site}...</form> : null}` style) is still flagged. The rule cannot tell whether the conditional resolves to a parent-of-hook configuration; it defaults to flagging because the colocation shape is itself a smell.
- The import source is matched against `'react-dom'` literally. If a user re-exports `useFormStatus` from a wrapper module (`'@/lib/react-dom-shim'`), the rule misses the re-export — but the wrapper file itself, if it imports from `'react-dom'`, would still get its own bindings tracked.
- The rule runs on every source file, regardless of boundary classification. The hook is a Client-Component-only primitive; calling it from a Server Component is itself an A2 concern. A5 does not duplicate that check.

---

## A6 — `use()` called with an inline-created Promise

**What it checks:** A call to React's `use()` hook (imported from `react`) where the Promise argument is created fresh on every render — either inline as `use(fetch(...))` / `use(new Promise(...))` / `use((async () => ...)())`, or held in a per-render local variable initialized to a non-stable expression. The Promise reference must be stable across renders for `use()` to deduplicate; an unstable reference produces infinite suspension.

**Severity:** high
**Detection:** AST scan. For each source file, collect the local binding(s) produced by `import { use } from 'react'`. For each call to a tracked binding, classify the first argument:

- **Inline expressions** (\`fetch(...)\`, \`Promise.resolve(...)\`, \`new Promise(...)\`, \`(async () => ...)()\`, any other call/new expression) → flag
- **Identifier reference** → resolve via the TS symbol table:
  - parameter (or destructured-rest from a parameter) → safe (caller supplied the value)
  - variable declared at module scope → safe (one Promise per app, shared)
  - variable declared inside a function whose initializer is a \`useMemo(...)\` / \`cache(...)\` call → safe (memoized)
  - variable declared inside a function with any other initializer → flag (unstable-local)
  - imported binding → safe
- **Property access** rooted in a parameter (\`props.dataPromise\`, \`ctx.value\`) → safe
- Anything else → no flag (conservative-by-default)

**Applies to:** React 19+. Imports from \`'react'\` are the gate; if \`use\` is a project-local helper that happens to share the name, the rule does nothing.

### Why it's a real problem

`use()` is React 19's primitive for unwrapping a Promise inside a component, suspending until the value is ready. The implementation looks the Promise up in a per-component cache keyed by reference identity. If the Promise reference changes on every render, every render produces a fresh cache miss, every render suspends, and React never gets to commit — the component is stuck in a permanent suspending state, the parent Suspense boundary keeps showing its fallback, and the symptom is "the page never loads" with no error to debug. Storybook stories, hot-reload, and dev-mode StrictMode double-invocations all amplify the symptom inconsistently, which makes it hard to diagnose from a bug report.

The fix is *reference stability*: the Promise must be a value created exactly once per render-key tuple — typically once at module scope (one per app), once inside `useMemo([deps])` (one per dep change), once via React's `cache()` for server-side memoization, or supplied by a stable parent through a prop. Any of those break the loop.

### Authoritative sources

- [React — `use()` reference](https://react.dev/reference/react/use) — *"`use` returns the resolved value of the resource, like a Promise or context. Unlike all other React Hooks, `use` can be called within loops and conditional statements like `if`. Like other React Hooks, the function that calls `use` must be a Component or Hook."*
- [React — Suspense for data fetching](https://react.dev/reference/react/Suspense) — Suspense boundaries depend on stable promise references.
- [React — `cache()` reference](https://react.dev/reference/react/cache) — recommended server-side stability primitive.

### Bad example

```tsx
'use client';
import { use } from 'react';

export const Inline = () => {
  const data = use(fetch('/api/data'));        // ❌ new Promise per render
  return <pre>{String(data)}</pre>;
};

export const LocalVar = () => {
  const dataPromise = fetch('/api/data');      // ❌ also new Promise per render
  const data = use(dataPromise);
  return <pre>{String(data)}</pre>;
};

export const Degenerate = ({ value }: { value: number }) => {
  const v = use(Promise.resolve(value));       // ❌ Promise.resolve(...) is also fresh per render
  return <span>{v}</span>;
};
```

### Fixed example

```tsx
'use client';
import { use, useMemo } from 'react';

// Module scope: one Promise per app.
const everyoneShared = fetch('/api/static');

export const ModuleScope = () => {
  const data = use(everyoneShared);            // ✅ stable reference
  return <pre>{String(data)}</pre>;
};

// useMemo: one Promise per change of the dep tuple.
export const Memoized = ({ id }: { id: string }) => {
  const dataPromise = useMemo(() => fetch(`/api/data/${id}`), [id]);
  const data = use(dataPromise);                // ✅ stable per id
  return <pre>{String(data)}</pre>;
};

// Prop: parent owns the Promise, child just consumes.
export const FromProp = ({ dataPromise }: { dataPromise: Promise<unknown> }) => {
  const data = use(dataPromise);                // ✅ as stable as the parent
  return <pre>{String(data)}</pre>;
};
```

### Known limitations

- The check is shallow: a Promise stored in a per-render local then `await`-ed via a helper that returns it is not traced through. v1 only inspects the call's direct argument.
- React's `cache()` is recognized as a stability wrapper alongside `useMemo`. Other custom memoizers (e.g., a project-local \`useStablePromise\`) are not recognized; they would produce a false positive.
- The argument-classifier has no fetch-chain awareness: \`use(loaderRef.current.promise)\` (an external mutable ref) is treated as `unknown` and not flagged. A subsequent enhancement could extend the property-access classifier to track refs and known stability primitives.
- Imports from any module specifier other than `'react'` are not tracked. A user helper named `use` that's actually wrapped React's `use` via a project barrel could miss the rule; conservative-by-default applies.

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

## C6 — `useActionState` dispatcher called outside `startTransition`

**What it checks:** A component calls the dispatcher returned by `useActionState` from `react` directly inside an event handler / `useEffect` / arbitrary call site, without wrapping it in `startTransition(...)` and without passing it as the value of a `<form action={dispatch}>` or `<button formAction={dispatch}>` JSX attribute. The dispatcher needs the transition to run inside; calling it bare skips that machinery and `isPending` stays `false` permanently.

**Severity:** medium
**Detection:** AST scan with two phases. First pass: collect the symbol of every dispatcher binding — the second array-binding element of `const [_, dispatch, _] = useActionState(...)`, where the call's callee resolves to a name imported from `react`. Second pass: for every identifier reference to a tracked dispatcher symbol, classify the parent context:
- Direct call \`dispatch(args)\` → flag unless an enclosing call to \`startTransition(...)\` is found anywhere up the AST chain (matching either the bare identifier or the `.startTransition` member access from a destructured \`useTransition()\` result).
- JSX attribute initializer where the attribute name is `action` or `formAction` → safe (React schedules the transition itself).
- JSX attribute initializer with any other name → conservative skip; the child component may forward the dispatcher to a `<form action>` correctly, and we don't chase across the component boundary.
- Anything else (variable assignment, return, spread) → skip.

**Applies to:** React 19+. Imports from `'react'` are the gate; if `useActionState` came from a project-local helper of the same name, the rule does nothing.

### Why it's a real problem

`useActionState` returns a `[state, dispatch, isPending]` tuple. The dispatcher's job is to invoke the action *inside a React transition*, so the returned `isPending` boolean tracks the in-flight state and the surrounding UI (a disabled button, a spinner, an animated form border) reflects that the user's submission is in progress. The transition is set up automatically when:
- the dispatcher is passed as `<form action={dispatch}>` / `<button formAction={dispatch}>` (React schedules the transition before invoking it), or
- the developer wraps the call in `startTransition(() => dispatch(...))` themselves.

Calling the dispatcher directly from an `onClick` / `onChange` / `useEffect` / async handler still *runs* the action — the underlying server function or reducer executes, the state updates eventually — but `isPending` never flips to `true`. The user clicks "save," nothing visually responds, the action takes 800 ms, and meanwhile the user clicks again. The bug is silent in TypeScript and in casual smoke testing because the data flow still works; only the UI loading-state contract is broken.

### Authoritative sources

- [React — `useActionState` reference](https://react.dev/reference/react/useActionState) — *"You can also call the action by passing it to `<form action={action}>`. … React will run the action when the form is submitted, and when called via `<form action>`, React automatically wraps it in a transition."*
- [React — `useTransition` reference](https://react.dev/reference/react/useTransition) — defines the alternate `startTransition` source.
- [React — `<form action>` reference](https://react.dev/reference/react-dom/components/form#props) — the recommended attachment point for action dispatchers.

### Bad example

```tsx
'use client';
import { useActionState } from 'react';

export const ClickyButton = () => {
  const [state, dispatch, pending] = useActionState(updateAction, 0);
  return (
    <button onClick={() => dispatch(new FormData())} disabled={pending}>
      {state}
    </button>
  );
};
```

```tsx
export const AutoRefresh = ({ id }: { id: number }) => {
  const [state, dispatch] = useActionState(refreshAction, 0);
  useEffect(() => {
    dispatch(id);                              // ❌ no transition wrap
  }, [id, dispatch]);
  return <span>{state}</span>;
};
```

### Fixed example

```tsx
'use client';
import { useActionState } from 'react';

// Variant A: assign as <form action> - React handles the transition.
export const FormAction = () => {
  const [state, dispatch, pending] = useActionState(submit, '');
  return (
    <form action={dispatch}>
      <input name="x" />
      <button type="submit" disabled={pending}>save</button>
      <span>{state}</span>
    </form>
  );
};
```

```tsx
'use client';
import { useActionState, startTransition } from 'react';

// Variant B: explicit startTransition wrap.
export const ManualTransition = () => {
  const [state, dispatch, pending] = useActionState(submit, '');
  return (
    <button
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          dispatch(new FormData());
        });
      }}
    >
      {state}
    </button>
  );
};
```

### Known limitations

- The transition check is a name-based ancestor walk. If a project rebinds `startTransition` under a different name (e.g., `const [pending, startT] = useTransition()`), calls inside `startT(...)` will not be recognized and the rule may produce a false positive. Codebases that destructure under the canonical name `startTransition` are covered.
- Pass-through to a child component as a non-form attribute (`<MyButton onPress={dispatch} />`) is treated as a conservative skip — the rule does not chase across the component boundary to verify the child uses it as `<form action>`. Real bugs at the eventual call site inside the child component are caught when the rule scans that child.
- Imports from any module specifier other than `'react'` are not tracked. A user helper named `useActionState` re-exported from a project barrel could miss the rule; conservative-by-default applies.
- The rule does not version-gate against React. `useActionState` shipped in React 19; calling it on React 18 produces a compile-time or runtime error that surfaces independently of this rule.

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

## D3 — `'use cache'` function reads request-scoped data

**What it checks:** A function or file marked with the `'use cache'` directive reads request-scoped state from inside the cached scope — `cookies()` / `headers()` / `draftMode()` from `next/headers`, a recognized auth helper (`auth()`, `currentUser()`, `validateRequest()`, `verify*Auth`/`require*Session`/etc.), or a `request`/`req` parameter's `.headers` / `.cookies` / `.url` / `.nextUrl`.

**Severity:** critical
**Detection:** AST walk with a `cached` flag carried through the recursion. Set true when the source file's directive prologue contains `'use cache'`, set true when entering a function whose body's directive prologue contains `'use cache'`. Calls and member accesses inside the cached scope are classified against the rule's known-bad sets. `next/headers` imports are tracked to identify the local binding for `cookies` / `headers` / `draftMode`. Auth helpers are matched by name — same set as C2.
**Applies to:** Next.js 16 stable. Skipped on Next.js 15 and below (`'use cache'` was only available in 15 behind the experimental `cacheComponents` flag).

### Why it's a real problem

`'use cache'` produces a memoized result keyed on the cached function's arguments. A request that hits a populated cache entry receives the *exact* return value computed by an earlier request — including any per-request data the cached function read internally. If that data is the current user's session cookie, the auth helper's resolved user object, or anything else that should differ from request to request, every subsequent request that hits the same cache key now reads the *first* user's data. This is not a "weird performance bug": it is one user being served as another user, the same severity class as a session-fixation or auth-bypass vulnerability.

The fix is an inversion: read the request-scoped value in the *caller* (a Route Handler, Server Action, or non-cached Server Component), then pass the resolved primitive (a user id, a role, a region string) into the cached function as an argument. That argument becomes part of the cache key, so each variant gets its own cache entry, and no two users share state.

### Authoritative sources

- [Next.js — `'use cache'` directive reference](https://nextjs.org/docs/app/api-reference/directives/use-cache) — describes the directive, what it caches, and the rule that cached functions cannot read request-time data.
- [Next.js — Caching in Next.js 16](https://nextjs.org/docs/app/getting-started/caching) — the wider caching model under which `'use cache'` operates, including `cacheLife` / `cacheTag` / `revalidateTag`.
- [Next.js — `cookies()` and `headers()` are dynamic APIs](https://nextjs.org/docs/app/api-reference/functions/cookies) — confirms these functions opt their caller into dynamic rendering and are not legal inside cached scopes.

### Bad example

```ts
// app/lib/cart.ts
import { cookies } from 'next/headers';

export const getCart = async () => {
  'use cache';
  const store = await cookies();        // ❌ poisons the cache with one user's session
  const sid = store.get('session')?.value;
  return loadCartFor(sid);
};
```

```ts
// app/lib/dashboard.ts
import { auth } from '@/auth';

export const getDashboard = async () => {
  'use cache';
  const session = await auth();         // ❌ caches one user's identity for everyone
  return loadDashboardFor(session?.user?.id);
};
```

### Fixed example

```ts
// app/lib/cart.ts — request-scoped read happens in the caller
const fetchCartForSession = async (sessionId: string) => {
  'use cache';
  return loadCartFor(sessionId);          // ✅ sessionId is part of the cache key
};

// app/page.tsx
import { cookies } from 'next/headers';
export default async function Page() {
  const sid = (await cookies()).get('session')?.value ?? '';
  return <Cart data={await fetchCartForSession(sid)} />;
}
```

### Known limitations

- Inter-procedural calls are not chased. A cached function that calls a helper which itself calls `cookies()` won't be flagged; the call site of the helper will appear safe to this rule.
- The `request`/`req` parameter check is name-based. Other parameter names (`incomingRequest`, `r`) won't be picked up. Custom convention coverage is intentional — the goal is to catch the obvious shape, not boil the ocean.
- The `use` keyword in the directive is matched literally on the string `'use cache'`. Variants like `'use cache: profile'` (Next.js cache profiles) are not yet recognized; treat as a future enhancement.
- Auth-helper detection is by call-name match (`KNOWN_AUTH_NAMES` + `verify*Auth`-style regex). A wrapping helper called `loadDashboardData` that internally calls `auth()` won't be flagged at the wrapper site — same inter-procedural limitation as above.
- Skipped on Next.js 15 and below. Projects using the Next.js 15 experimental `cacheComponents` flag with `'use cache'` are not covered until they upgrade to 16.

---

## D4 — `'use cache'` function without `cacheLife` or `cacheTag`

**What it checks:** A function marked with the `'use cache'` directive — either as a function-body directive or implicitly via its enclosing file's directive prologue — does not call `cacheLife()` or `cacheTag()` from `next/cache`. The cache lifetime and invalidation behavior are left at framework defaults.

**Severity:** medium
**Detection:** AST walk. For each cached scope (a function with its own `'use cache'` directive, or every top-level function in a file that begins with `'use cache'`), the rule scans the function body for a call expression whose callee identifier is bound (via a `next/cache` import) to `cacheLife` or `cacheTag`. If neither call is present, the rule emits one finding per cached function.
**Applies to:** Next.js 16 stable. Skipped on Next.js 15 and below.

### Why it's a real problem

`'use cache'` without `cacheLife` or `cacheTag` is technically valid — but it's a contract leak. Reading the function tells you the result is cached; it does not tell you for how long, what invalidates it, or how to reason about staleness. Behavior comes from framework defaults that vary between Next.js minor releases (the team has shifted them at least once already in the 16.x line) and from any global profile in `next.config.js`. Staff reviewing the function months later — including the original author — will guess wrong about its semantics.

The fix is small and self-documenting: pair every `'use cache'` with at least one of `cacheLife('<profile>')` (defines the lifetime) or `cacheTag('<key>')` (lets a Server Action invalidate this cache via `revalidateTag`). The directive plus one configurator explains the cache contract right where the code lives.

### Authoritative sources

- [Next.js — `cacheLife` reference](https://nextjs.org/docs/app/api-reference/functions/cache-life) — defines lifetime profiles and the per-function call shape.
- [Next.js — `cacheTag` reference](https://nextjs.org/docs/app/api-reference/functions/cache-tag) — defines tag-based invalidation, paired with `revalidateTag` from Server Actions.
- [Next.js — `'use cache'` directive guide](https://nextjs.org/docs/app/getting-started/caching#use-cache) — the recommended pairing pattern.

### Bad example

```ts
// app/lib/catalog.ts
export const getCatalog = async () => {
  'use cache';                              // ❌ no cacheLife, no cacheTag
  return loadCatalog();
};
```

```ts
// app/lib/dashboard.ts — file-level directive without per-function tags
'use cache';

export const getProducts = async () => loadProducts();    // ❌ no tags
export const getCategories = async () => loadCategories(); // ❌ no tags
```

### Fixed example

```ts
import { cacheLife, cacheTag } from 'next/cache';

export const getCatalog = async () => {
  'use cache';
  cacheLife('hours');                       // ✅ explicit lifetime
  cacheTag('catalog');                      // ✅ invalidatable tag
  return loadCatalog();
};
```

### Known limitations

- Cached scope membership is determined statically: top-level function declarations / variable-initializer arrows in a file-level cached file, plus any function whose body's directive prologue is `'use cache'`. Helpers nested inside an outer cached function are not independently flagged (they share the outer cache key).
- The rule only counts direct `cacheLife()` / `cacheTag()` calls inside the function body. A wrapping helper that calls them on the cached function's behalf is not chased — same inter-procedural limitation as D3.
- Identifier resolution is via the `next/cache` import — local rebinds (`import { cacheLife as _cl }`) are followed; star-imports (`import * as next from 'next/cache'`) are not.
- The `cacheLife` and `cacheTag` exports from `next/cache` are the only configurators recognized; project-local helpers that wrap them are out of scope.
- Skipped entirely on Next.js 15 and below. Projects using the Next.js 15 experimental `cacheComponents` flag with `'use cache'` are not covered until they upgrade to 16.

---

## D5 — `revalidateTag` / `revalidatePath` / `updateTag` outside a mutation context

**What it checks:** A call to `revalidateTag`, `revalidatePath`, or `updateTag` (imported from `next/cache`) sits in a context where it cannot meaningfully invalidate anything: inside a `'use cache'` function (contradictory), inside a `'use client'` file (throws), or during a Server Component render (no-ops or fights itself).

**Severity:** high
**Detection:** AST walk with a context object tracking `inUseCache`, `inUseServer`, and `inRouteHandler` flags as it descends through function-like nodes. The directive prologue of each function body is inspected; the source file's top-level directives are baked into the starting context. Calls to the imported revalidation names — resolved against the local binding produced by a `next/cache` import (so `import { revalidateTag as bust }` is followed) — are then classified by the active context. Conservative-by-default: a directive-less helper module is not flagged, because the rule cannot tell whether the helper is invoked from a Server Action (safe) or from a render path (unsafe).
**Applies to:** Next.js 13.4+ (when `revalidateTag`/`revalidatePath` shipped). Not version-gated by this rule — the failure modes are identical across 13.4, 14, 15, and 16.

### Why it's a real problem

`revalidateTag` and friends are mutation primitives — they evict cached responses so the *next* request rebuilds. They only make sense in code paths that *cause* the data to change: Server Actions and Route Handlers. Calling them anywhere else fails in three distinct, increasingly-bad ways:

- **Inside a Client Component**: `next/cache` is a server-only module. The import either throws at runtime (older Next.js minor versions) or is rejected by the bundler outright. Either way: dead code that broke production.
- **During a Server Component render**: the call executes on every render, on the read path. It either silently no-ops against an unbuilt cache or it invalidates mid-render, producing two-pass output where one render reads stale data and the next doesn't. Diagnosing this from a bug report is expensive.
- **Inside a `'use cache'` function**: contradictory. The cached function memoizes its output for reuse; invalidating from inside it fights its own caching strategy. The Next.js team has explicitly documented this as a misuse, but the call shape compiles cleanly and TypeScript can't catch it.

The fix is structural, not local: move the call to the Server Action or Route Handler that performs the data mutation. Render is a read path; mutation lives elsewhere.

### Authoritative sources

- [Next.js — `revalidateTag` reference](https://nextjs.org/docs/app/api-reference/functions/revalidateTag) — *"`revalidateTag` only invalidates the cache when the path is next visited. This means calling `revalidateTag` with a dynamic route segment will not immediately trigger many revalidations at once. The invalidation only happens when the path is next visited."*
- [Next.js — `revalidatePath` reference](https://nextjs.org/docs/app/api-reference/functions/revalidatePath) — same constraint surface; the function is documented for use in Server Actions and Route Handlers.
- [Next.js — Server Actions and mutations](https://nextjs.org/docs/app/getting-started/updating-data) — establishes the mental model: mutations run in Server Actions / Route Handlers, and *those* are where invalidation belongs.

### Bad example

```tsx
// app/admin/page.tsx — Server Component render
import { revalidatePath } from 'next/cache';

export default async function AdminPage() {
  revalidatePath('/admin');                 // ❌ no-ops on render path
  return <div>admin</div>;
}
```

```tsx
// app/components/RefreshButton.tsx
'use client';
import { revalidateTag } from 'next/cache';

export const RefreshButton = () =>
  <button onClick={() => revalidateTag('feed')}>refresh</button>;  // ❌ throws / blocked by bundler
```

```ts
// app/lib/things.ts
import { revalidateTag } from 'next/cache';
export const getThings = async () => {
  'use cache';
  revalidateTag('things');                   // ❌ cached function invalidating itself
  return loadThings();
};
```

### Fixed example

```ts
// app/lib/actions.ts — file-level Server Action context
'use server';
import { revalidateTag, revalidatePath } from 'next/cache';

export const updatePost = async (id: string) => {
  await db.posts.update({ where: { id }, data: { /* ... */ } });
  revalidateTag(`post-${id}`);
  revalidatePath(`/posts/${id}`);
};
```

```tsx
// app/profile/page.tsx — inline `'use server'` action inside a Server Component
import { revalidateTag } from 'next/cache';

export default async function ProfilePage() {
  const action = async (formData: FormData) => {
    'use server';
    await db.profile.update({ /* ... */ });
    revalidateTag('profile');                // ✅ inside a Server Action
  };
  return <form action={action} />;
}
```

```ts
// app/api/posts/route.ts — Route Handler
import { revalidateTag } from 'next/cache';

export const POST = async (request: Request) => {
  await handlePost(request);
  revalidateTag('posts');                     // ✅ inside an HTTP method handler
  return new Response('ok');
};
```

### Known limitations

- **Helper modules without directives are intentionally not flagged.** A file like `lib/cache-helpers.ts` with a `bumpFeed = () => revalidateTag('feed')` could be called from a Server Action (safe) or from a render path (unsafe); the rule cannot tell which without interprocedural analysis. Conservative-by-default applies — the bug surfaces when the helper is *called* in a flagged context (a Client Component, a render path, etc.), provided the call is direct.
- **Interprocedural call-chain following is not implemented.** The plan describes "follow the call chain one level"; the rule presently classifies only at the call site. A wrapper inside a Server Action that delegates to a directive-less helper still works correctly (the wrapper itself is the call site), but a wrapper called from a render path will not be reported via the wrapper.
- **Identifier resolution is via the `next/cache` import.** Star-imports (`import * as nextCache from 'next/cache'`) are not followed. Local rebinds (`import { revalidateTag as bust }`) are followed.
- **The `'use server'` and `'use cache'` directives are matched literally on the directive prologue.** Variants like `'use server: pages'` or directive prologues that precede the target with non-string statements are not recognized.
- **Route handlers are detected by file basename `route.{ts,tsx,js,jsx}` under an `app/` directory and by HTTP-method export name.** Custom routing structures are not covered.
- **Top-level module code in a route file is treated as library code, not as a route handler.** Calling `revalidateTag` at module load is rare and mostly degenerate; the rule deliberately under-flags it.

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

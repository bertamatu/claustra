'use client';

// Client Component importing a Server Action. At build time Next.js replaces
// `update` with a fetch stub; nothing from `app/actions/update.ts` (or its
// transitive imports - node:fs, lib/db.ts, @prisma/client, secret env var)
// reaches the client bundle. This file should produce zero a01 findings.
import { update } from '../app/actions/update.js';

export const Form = () => {
  return (
    <form action={(fd) => update(String(fd.get('id')), String(fd.get('value')))}>
      <input name="id" />
      <input name="value" />
      <button type="submit">save</button>
    </form>
  );
};

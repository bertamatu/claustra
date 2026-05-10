'use server';

// A real Server Action: server-only code, imports a real DB driver and reads
// a secret env var. When a Client Component imports `update` from this file,
// Next.js replaces the import with a thin RPC stub at build time - the actual
// code below NEVER crosses into the client bundle. The whole transitive
// import chain stays server-side.
import fs from 'node:fs';
import { db } from '../../lib/db.js';

export const update = async (id: string, value: string): Promise<void> => {
  fs.writeFileSync(`/tmp/audit-${id}.log`, value);
  await db.user.update({ where: { id }, data: { value } });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  void process.env.SECRET_KEY!;
};

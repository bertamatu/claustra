'use client';

// Wrapper that imports a server-leaning helper. The boundary classifier marks
// `lib/db-helpers.ts` as reachable from the client tree, so D01 still scans
// it - but its symbol resolution recognizes that `document` inside that file
// is a parameter, not the browser global.
import { updateDocument } from '../lib/db-helpers.js';

type DocumentProp = { id: string; title: string; createdAt: Date };

export const Wrapper = ({ doc }: { doc: DocumentProp }) => {
  const next = updateDocument(doc, '!');
  return <span>{next.title}</span>;
};

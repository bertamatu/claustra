// No 'use client' directive, but imported by `client-parent.tsx` below.
// The boundary classifier marks this file as 'either' - reachable from the
// client tree. In Next.js, once a module is pulled into the client bundle by
// a `'use client'` boundary, this file's code executes in the client tree
// too, so passing a function to a Client Component child does NOT cross any
// boundary. claustra B01 must NOT flag this.
import { Widget } from './widget.js';

export const EitherHelper = (): JSX.Element => {
  const handler = (): void => {};
  return <Widget cb={handler} />;
};

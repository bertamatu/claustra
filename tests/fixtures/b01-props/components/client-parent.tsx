'use client';
import { Widget } from './widget.js';
import { EitherHelper } from './either-helper.js';
import { UserClass } from '../lib/user-class.js';

// A Client Component that renders other Client Components.
// Function / Date / class instance props from here do NOT cross the
// server/client boundary - both sides run in the browser. claustra
// must not flag any of these.
//
// The import of `EitherHelper` (a non-directive component) is intentional:
// it pulls `either-helper.tsx` into the client-reachable graph, so the
// boundary classifier marks it as 'either'. claustra must skip B01 on
// 'either' files for the same reason it skips 'client'.
export const ClientParent = (): JSX.Element => {
  const handler = (): void => {};
  return (
    <div>
      <Widget cb={handler} />
      <Widget cb={() => console.log('inline')} />
      <Widget date={new Date()} />
      <Widget map={new Map<string, string>()} />
      <Widget user={new UserClass('alice')} />
      <Widget big={1n} />
      <Widget sym={Symbol('x')} />
      <EitherHelper />
    </div>
  );
};

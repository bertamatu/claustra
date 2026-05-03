'use client';
import { Widget } from './widget.js';
import { UserClass } from '../lib/user-class.js';

// A Client Component that renders other Client Components.
// Function / Date / class instance props from here do NOT cross the
// server/client boundary — both sides run in the browser. claustra
// must not flag any of these.
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
    </div>
  );
};

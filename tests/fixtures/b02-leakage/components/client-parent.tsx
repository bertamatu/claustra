'use client';
import { Card } from './card.js';

// A Client Component that renders other Client Components.
// Sensitive prop names and spread props from here do NOT cross the
// server/client boundary — both sides run in the browser. claustra
// must not flag any of these.
export const ClientParent = (): JSX.Element => {
  const obj = { name: 'a', secret: 'b' };
  return (
    <div>
      <Card secret="abc" />
      <Card token="t" />
      <Card password="p" />
      <Card {...obj} />
    </div>
  );
};

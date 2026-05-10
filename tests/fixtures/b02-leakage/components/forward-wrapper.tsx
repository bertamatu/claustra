// Server Component (no `'use client'`) that wraps a Client Component using
// the React forwarding-prop pattern. The spread `{...props}` originates from
// the wrapper's own typed parameter - the caller already supplied the value
// (typically a Server Component passing through, or another wrapper).
//
// claustra B02 must NOT flag this. The forwarding pattern is the dominant
// shape in shadcn/ui-style component libraries. Only flag spreads that
// clearly originate server data (e.g., a whole-record DB query result).
import { Card, type CardProps } from './card.js';

export const CardWrapper = (props: CardProps): JSX.Element => <Card {...props} />;

// Destructured-rest variant is also common: `({ className, ...rest })`.
type WithClass = CardProps & { className?: string };
export const CardWithClass = ({ className, ...rest }: WithClass): JSX.Element => (
  <Card data-cls={className} {...rest} />
);

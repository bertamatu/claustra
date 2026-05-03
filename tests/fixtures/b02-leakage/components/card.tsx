'use client';
import type { ReactNode } from 'react';

export type CardProps = {
  name?: string;
  email?: string;
  user?: unknown;
  secret?: string;
  token?: string;
  password?: string;
  apiKey?: string;
  privateKey?: string;
  hash?: string;
  salt?: string;
  sessionId?: string;
  stripeSecret?: string;
  jwt?: string;
  children?: ReactNode;
} & Record<string, unknown>;

export const Card = (_p: CardProps): JSX.Element => <div>card</div>;

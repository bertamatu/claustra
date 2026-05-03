'use client';
import { fetchUser } from '../lib/user-service.js';

export const BadDeepChain = (): JSX.Element => {
  void fetchUser;
  return <span>deep</span>;
};

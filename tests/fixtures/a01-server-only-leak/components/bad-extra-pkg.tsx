'use client';
import { sign } from 'my-internal-secrets';

export const BadExtraPkg = (): JSX.Element => {
  void sign;
  return <span>extras</span>;
};

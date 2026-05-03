'use client';
import { readFileSync } from 'node:fs';

export const BadDirectFs = (): JSX.Element => {
  const data = readFileSync('/etc/hostname', 'utf8');
  return <span>{data}</span>;
};

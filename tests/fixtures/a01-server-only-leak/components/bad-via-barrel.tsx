'use client';
import { wrappedConnect } from '../lib/barrel.js';

export const BadViaBarrel = (): JSX.Element => {
  void wrappedConnect;
  return <span>barrel</span>;
};

// VIOLATION A2: directive appears after an import - silently ignored by Next.js
import { useState } from 'react';

'use client';

export const Misplaced = () => {
  const [n] = useState(0);
  return <p>{n}</p>;
};

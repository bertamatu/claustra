'use client';

import { useEffect, useState } from 'react';

// Reads only - `getItem` calls must NOT be flagged. Suspect-named keys
// here are deliberate to confirm the rule only fires on writes.
export const CorrectGetItem = (): JSX.Element => {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    const t = localStorage.getItem('auth_token');
    const j = sessionStorage.getItem('jwt');
    setValue(t ?? j);
  }, []);
  return <span>{value ?? '-'}</span>;
};

'use client';

// `if (typeof X !== 'undefined') { ...read X... }` is a positive-block guard:
// the read sits inside the if-then branch, gated by the check. claustra D1
// must recognize this in addition to the early-return form.
import { useState } from 'react';

export const ScrollToTop = () => {
  const [, setSeen] = useState(false);

  if (typeof window !== 'undefined') {
    // Inside the gated branch - safe.
    const y = window.scrollY;
    if (y > 100) setSeen(true);
  }

  if (typeof document !== 'undefined') {
    document.title = 'gated';
  }

  return null;
};

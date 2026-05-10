'use client';

// Functions guarded by a `typeof window === 'undefined'` early return are
// gated to client-side execution. claustra D1 must NOT flag any browser-global
// reads or `new Date()` calls that appear after the guard.

export const initWithEarlyReturn = (): void => {
  if (typeof window === 'undefined') return;
  // All of the following are reachable only in the browser.
  window.localStorage.setItem('k', 'v');
  document.body.appendChild(document.createElement('div'));
  const ts = new Date(); // also gated
  void ts;
};

export const initWithEarlyThrow = (): void => {
  if (typeof document === 'undefined') throw new Error('client-only');
  document.title = 'hello';
  navigator.clipboard.writeText('x');
};

export const initWithBlockGuard = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem('k', 'v');
};

// Sanity: a function with NO guard still gets flagged.
export const noGuard = (): void => {
  document.title = 'oops'; // ❌ should still flag
};

'use client';

// Ternary-form typeof guards. The browser-global read is in the gated
// branch; claustra D1 must recognize both directions.
//
//   typeof X !== 'undefined' ? X.y : fallback   (truthy branch)
//   typeof X === 'undefined' ? fallback : X.y   (falsy branch)
export const TernaryGuards = () => {
  // Truthy-branch read - safe.
  const docTitle = typeof document !== 'undefined' ? document.title : '<ssr>';

  // Falsy-branch read - safe.
  const lang = typeof navigator === 'undefined' ? 'en' : navigator.language;

  return (
    <span>
      {docTitle} / {lang}
    </span>
  );
};

'use client';

// VIOLATION D1: reads of window/document/navigator in render scope
export const BadBrowserGlobals = () => (
  <div>
    <p>{window.location.href}</p>
    <p>{document.title}</p>
    <p>{navigator.userAgent}</p>
  </div>
);

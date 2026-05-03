'use client';

// NON-VIOLATION: trigger expressions inside event handlers are safe
export const CorrectEventHandler = () => (
  <button
    onClick={() => {
      console.log(Date.now(), Math.random(), window.location.href);
    }}
  >
    Click
  </button>
);

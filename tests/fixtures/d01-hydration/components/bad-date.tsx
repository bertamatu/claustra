'use client';

// VIOLATION D1: Date.now() and `new Date()` in render scope
export const BadDate = () => (
  <div>
    {Date.now()}
    <span>{new Date().toString()}</span>
  </div>
);

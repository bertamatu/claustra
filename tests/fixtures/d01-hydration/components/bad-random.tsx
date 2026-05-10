'use client';

// VIOLATION D1: Math.random + crypto.randomUUID in render scope
export const BadRandom = () => (
  <div>
    <p>{Math.random()}</p>
    <p>{crypto.randomUUID()}</p>
  </div>
);

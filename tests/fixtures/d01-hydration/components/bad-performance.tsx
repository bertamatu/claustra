'use client';

// VIOLATION D1: performance.now() in render scope
export const BadPerformance = () => <p>{performance.now()}</p>;

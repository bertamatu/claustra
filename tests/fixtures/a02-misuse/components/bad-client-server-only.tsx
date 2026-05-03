'use client';

// VIOLATION A2: client file imports the explicit `server-only` guard
import 'server-only';

export const Bad = () => <p>nope</p>;

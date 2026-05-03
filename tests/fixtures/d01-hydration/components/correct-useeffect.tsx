'use client';

// NON-VIOLATION: trigger expressions inside useEffect are safe
import { useState, useEffect } from 'react';

export const CorrectUseEffect = () => {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    setTime(new Date().toLocaleString());
    const id = Math.random();
    console.log(id, performance.now());
  }, []);
  return <p>{time ?? 'Loading...'}</p>;
};

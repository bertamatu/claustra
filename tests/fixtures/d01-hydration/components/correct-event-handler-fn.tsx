'use client';

// A function declared at component scope and referenced as a JSX event-handler
// value. Browser globals read inside the function body are gated to user-
// triggered events, NOT render scope. claustra D1 must skip these.
//
// This is the dominant real-world shape for theme toggles, copy-to-clipboard
// buttons, table-of-contents scroll handlers, etc.
import { useState } from 'react';

export const ThemeToggle = () => {
  const [, setTheme] = useState<'light' | 'dark'>('light');

  // Direct reference: <button onClick={toggleTheme}>
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'light' : 'dark');
  };

  // Inline-arrow reference: <button onClick={() => handleConsent(false)}>
  const handleConsent = (granted: boolean) => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 365);
    document.cookie = `consent=${granted}; expires=${expiry.toUTCString()}`;
  };

  return (
    <>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => handleConsent(true)}>accept</button>
      <button onClick={() => handleConsent(false)}>decline</button>
    </>
  );
};

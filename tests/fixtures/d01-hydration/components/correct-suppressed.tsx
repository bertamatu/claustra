// NON-VIOLATION: suppressHydrationWarning silences the check
export const CorrectSuppressed = () => (
  <p suppressHydrationWarning>{Date.now()}</p>
);

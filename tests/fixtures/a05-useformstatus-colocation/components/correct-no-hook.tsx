'use client';

// ✅ Form with no useFormStatus call - vanilla form, nothing to flag.
export const Plain = () => (
  <form action="/api/submit">
    <input name="x" />
    <button type="submit">save</button>
  </form>
);

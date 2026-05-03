// VIOLATION D1: locale-dependent formatters without explicit locale
export const BadLocale = ({ when }: { when: Date }) => (
  <div>
    <p>{when.toLocaleString()}</p>
    <p>{when.toLocaleDateString()}</p>
    <p>{new Intl.DateTimeFormat().format(when)}</p>
  </div>
);

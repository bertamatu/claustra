// NON-VIOLATION: explicit locale argument is safe
export const CorrectExplicitLocale = ({ when }: { when: Date }) => (
  <div>
    <p>{when.toLocaleString('en-US')}</p>
    <p>{new Intl.DateTimeFormat('en-US').format(when)}</p>
  </div>
);

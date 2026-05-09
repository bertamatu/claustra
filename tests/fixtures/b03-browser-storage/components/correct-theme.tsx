'use client';

export const CorrectTheme = (): JSX.Element => {
  const setTheme = (theme: string): void => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('locale', 'en-US');
    localStorage.setItem('ui-state.expanded', '1');
  };
  return <button onClick={() => setTheme('dark')}>dark</button>;
};

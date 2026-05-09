import { BadTokenKey } from '../components/bad-token-key';
import { BadJwt } from '../components/bad-jwt';
import { BadPiiStringify } from '../components/bad-pii-stringify';
import { MediumSecureWrapper } from '../components/medium-secure-wrapper';
import { CorrectTheme } from '../components/correct-theme';
import { CorrectGetItem } from '../components/correct-get-item';
import { CorrectEncrypt } from '../components/correct-encrypt';
import { CorrectWindowSafe } from '../components/correct-window-safe';
import { BadWindowJwt } from '../components/bad-window-jwt';

// Server-only file: a setItem call here must NOT be flagged because it is
// not reachable from a 'use client' file.
const _ignoredOnServer = (): void => {
  // @ts-expect-error - localStorage is DOM-only, but we're just asserting
  // the rule does not even read this file. The expression never runs.
  if (typeof localStorage !== 'undefined') localStorage.setItem('jwt', 'x');
};

export default function Page(): JSX.Element {
  void _ignoredOnServer;
  return (
    <main>
      <BadTokenKey />
      <BadJwt />
      <BadPiiStringify />
      <MediumSecureWrapper />
      <CorrectTheme />
      <CorrectGetItem />
      <CorrectEncrypt />
      <CorrectWindowSafe />
      <BadWindowJwt />
    </main>
  );
}

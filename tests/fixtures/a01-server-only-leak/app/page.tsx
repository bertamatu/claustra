import { BadDeepChain } from '../components/bad-deep-chain.js';
import { CorrectClient } from '../components/correct-client.js';
import { CorrectPublicEnv } from '../components/correct-public-env.js';
import { BadDirectFs } from '../components/bad-direct-fs.js';
import { BadDirectPrisma } from '../components/bad-direct-prisma.js';
import { BadProcessEnv } from '../components/bad-process-env.js';
import { BadServerOnly } from '../components/bad-server-only.js';
import { BadExtraPkg } from '../components/bad-extra-pkg.js';
import { BadViaBarrel } from '../components/bad-via-barrel.js';

export default function Page(): JSX.Element {
  return (
    <main>
      <BadDeepChain />
      <CorrectClient />
      <CorrectPublicEnv />
      <BadDirectFs />
      <BadDirectPrisma />
      <BadProcessEnv />
      <BadServerOnly />
      <BadExtraPkg />
      <BadViaBarrel />
    </main>
  );
}

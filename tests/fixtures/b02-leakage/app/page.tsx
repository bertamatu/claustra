import { Card } from '../components/card.js';
import { ServerCard } from '../components/server-card.js';
import { db, UserModel } from '../lib/db.js';

export default async function Page(): Promise<JSX.Element> {
  // Whole-record query (no select/omit) - should flag user prop
  const fullUser = await db.user.findUnique({ where: { id: '1' } });
  const fullPost = await db.post.findFirst();
  const mongoUser = await UserModel.findOne({ id: '1' });

  // Selected query - should NOT flag
  const safeUser = await db.user.findUnique({
    where: { id: '1' },
    select: { id: true, name: true },
  });

  // Omit-only - should NOT flag
  const safeUser2 = await db.user.findUnique({
    where: { id: '1' },
    omit: { passwordHash: true },
  });

  // Destructured - should NOT flag (value is plain string)
  const dest = (await db.user.findUnique({ where: { id: '1' } })) as { name: string };
  const { name } = dest;

  // Spread record source object
  const spreadable = { secret: 's', name: 'a' };

  const tokenValue = 'abc';
  const passwordValue = 'pwd';
  const apiKeyValue = 'k';
  const privateKeyValue = 'pk';
  const hashValue = 'h';
  const saltValue = 's';
  const sessionIdValue = 'si';
  const stripeSecretValue = 'ss';
  const jwtValue = 'jwt';
  const secretObj = 'sec';

  return (
    <main>
      {/* Sensitive name regex - flag each */}
      <Card secret={secretObj} />
      <Card token={tokenValue} />
      <Card password={passwordValue} />
      <Card apiKey={apiKeyValue} />
      <Card privateKey={privateKeyValue} />
      <Card hash={hashValue} />
      <Card salt={saltValue} />
      <Card sessionId={sessionIdValue} />
      <Card stripeSecret={stripeSecretValue} />
      <Card jwt={jwtValue} />

      {/* Whole-record - flag */}
      <Card user={fullUser} />
      <Card user={fullPost} />
      <Card user={mongoUser} />

      {/* Selected/omit - no flag */}
      <Card user={safeUser} />
      <Card user={safeUser2} />

      {/* Destructured field - no flag */}
      <Card name={name} />

      {/* Spread of a whole-record query result - flag */}
      <Card {...fullUser} />

      {/* Spread of a select/omit-filtered query - no flag */}
      <Card {...safeUser} />

      {/* Spread of a static literal - no flag (no server data origin) */}
      <Card {...spreadable} />

      {/* Allowed plain strings */}
      <Card name="alice" email="a@b.c" />

      {/* Server component target - no flag even with sensitive name / spread */}
      <ServerCard secret={secretObj} />
      <ServerCard {...fullUser} />
    </main>
  );
}

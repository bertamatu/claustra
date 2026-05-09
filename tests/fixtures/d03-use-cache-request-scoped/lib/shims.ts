// Minimal shims so cached lib files typecheck without pulling
// next-auth / clerk into the fixture's tsconfig include set.

export const auth = async (): Promise<{ user: { id: string } } | null> => null;

export const verifyUserSession = async (): Promise<{ id: string }> => ({ id: 'u' });

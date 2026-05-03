type Args = Record<string, unknown>;
type Delegate = {
  create: (a: Args) => Promise<unknown>;
  update: (a: Args) => Promise<unknown>;
  delete: (a: Args) => Promise<unknown>;
  upsert: (a: Args) => Promise<unknown>;
  findUnique: (a: Args) => Promise<unknown>;
  findMany: (a: Args) => Promise<unknown>;
};

export const db = {
  post: {} as Delegate,
  user: {} as Delegate,
};

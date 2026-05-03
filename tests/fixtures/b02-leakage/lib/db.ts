type Args = Record<string, unknown>;
type Delegate = {
  findFirst: (a?: Args) => Promise<unknown>;
  findUnique: (a?: Args) => Promise<unknown>;
  findMany: (a?: Args) => Promise<unknown>;
  findFirstOrThrow: (a?: Args) => Promise<unknown>;
};

export const db = {
  user: {} as Delegate,
  post: {} as Delegate,
};

// Mongoose-style
type MongooseModel = {
  findOne: (q?: Args) => Promise<unknown>;
  find: (q?: Args) => Promise<unknown>;
  findById: (id: string) => Promise<unknown>;
};
export const UserModel = {} as MongooseModel;

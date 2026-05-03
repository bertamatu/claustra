import { PrismaClient } from '@prisma/client';

const client = new PrismaClient();

export const db = {
  user: (id: string): Promise<unknown> => Promise.resolve({ id, client }),
};

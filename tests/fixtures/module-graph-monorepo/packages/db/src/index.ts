import { PrismaClient } from '@prisma/client';

const client = new PrismaClient();

export const findUser = (id: string): unknown => ({ id, client });

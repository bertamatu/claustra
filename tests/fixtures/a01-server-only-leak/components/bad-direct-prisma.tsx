'use client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const BadDirectPrisma = (): JSX.Element => {
  void prisma;
  return <span>oops</span>;
};

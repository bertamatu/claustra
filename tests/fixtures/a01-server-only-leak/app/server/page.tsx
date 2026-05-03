import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';

const prisma = new PrismaClient();

export default async function ServerPage(): Promise<JSX.Element> {
  const config = readFileSync('/etc/hostname', 'utf8');
  void prisma;
  void config;
  return <main>server</main>;
}

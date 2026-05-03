import pc from 'picocolors';

export const logger = {
  info: (msg: string) => console.error(pc.dim(`[claustra] ${msg}`)),
  warn: (msg: string) => console.error(pc.yellow(`[claustra] ${msg}`)),
  error: (msg: string) => console.error(pc.red(`[claustra] ${msg}`)),
};

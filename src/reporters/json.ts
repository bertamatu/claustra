import type { Finding } from '../rules/types.js';

export const jsonReporter = (findings: Finding[]): void => {
  console.log(JSON.stringify({ findings }, null, 2));
};

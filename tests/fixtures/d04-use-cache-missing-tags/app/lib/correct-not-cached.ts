// Function with no `'use cache'` directive - rule should not flag it.
export const getServerSnapshot = async () => {
  return { ts: Date.now() };
};

// Synthetic DB shim used only to give c03 fixtures a recognizable
// mutation receiver. Never installed, never executed.
export const db = {
  subscription: {
    create: async (_: unknown): Promise<void> => {},
    update: async (_: unknown): Promise<void> => {},
    upsert: async (_: unknown): Promise<void> => {},
  },
  invoice: {
    create: async (_: unknown): Promise<void> => {},
  },
};

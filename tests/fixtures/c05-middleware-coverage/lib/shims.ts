// Minimal shims so route handlers and pages typecheck without pulling
// next-auth / clerk / prisma into the fixture's tsconfig include set.

export const auth = async (): Promise<{ user: { id: string } } | null> => null;
export const currentUser = async (): Promise<{ id: string } | null> => null;

export const db = {
  user: {
    create: async (args: unknown): Promise<unknown> => args,
    update: async (args: unknown): Promise<unknown> => args,
    delete: async (args: unknown): Promise<unknown> => args,
  },
};

// Stand-in for stripe.webhooks.constructEvent to test the webhook
// exemption path.
export const stripe = {
  webhooks: {
    constructEvent: (body: string, sig: string, secret: string): { type: string } => {
      void body; void sig; void secret;
      return { type: 'noop' };
    },
  },
};

// Conservative-by-default: a helper module with no directive does NOT get
// flagged. We can't statically tell whether it is called from a Server
// Action (safe) or from a render path (unsafe).
import { revalidateTag } from 'next/cache';

export const bumpFeed = () => {
  revalidateTag('feed');
};

'use cache';

import { draftMode } from 'next/headers';

export const getDraftAwareContent = async () => {
  const dm = await draftMode();
  return { isEnabled: dm.isEnabled, items: [] };
};

'use server';

import { revalidateTag, revalidatePath } from 'next/cache';

export const updatePost = async (id: string) => {
  await Promise.resolve(id);
  revalidateTag(`post-${id}`);
  revalidatePath(`/posts/${id}`);
};

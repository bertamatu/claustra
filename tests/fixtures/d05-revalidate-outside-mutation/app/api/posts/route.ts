import { revalidateTag } from 'next/cache';

export const POST = async (request: Request) => {
  await request.json();
  revalidateTag('posts');
  return new Response('ok');
};

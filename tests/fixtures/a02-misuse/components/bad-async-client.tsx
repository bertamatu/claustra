'use client';

// VIOLATION A2: async component in a client file
export default async function BadAsyncClient() {
  const data = await fetch('/api/x').then((r) => r.json() as Promise<{ msg: string }>);
  return <p>{data.msg}</p>;
}

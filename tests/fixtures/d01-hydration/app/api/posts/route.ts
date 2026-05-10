// Route handlers run server-side per request. They never hydrate. Hydration
// risks like `new Date()` are not a concern here.
export const POST = async (request: Request) => {
  await request.json();
  const ts = new Date();
  return new Response(JSON.stringify({ at: ts.toISOString() }));
};

export const GET = async () => {
  const ts = Date.now();
  return new Response(String(ts));
};

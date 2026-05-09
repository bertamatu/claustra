// Hardcoded host via process.env: tainted id appended to a base read
// from the environment. Not SSRF.
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const url = process.env.UPSTREAM_BASE + '/items/' + id;
  const r = await fetch(url);
  return new Response(await r.text());
}

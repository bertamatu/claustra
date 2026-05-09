// Hardcoded host: tainted value is interpolated into the path/query of
// a literal-host URL. Not SSRF — host is fixed.
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const r = await fetch(`https://api.example.com/items/${id}`);
  return new Response(await r.text());
}

// Source: route segment via the second-arg destructured `params`.
// Concatenated into a fetch URL such that the host comes from
// `params.host`, not a literal - SSRF.
export async function GET(
  _request: Request,
  { params }: { params: { host: string; path: string } },
): Promise<Response> {
  const url = `https://${params.host}/${params.path}`;
  const r = await fetch(url);
  return new Response(await r.text());
}

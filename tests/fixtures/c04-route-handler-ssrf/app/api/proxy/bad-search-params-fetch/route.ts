// Source: searchParams.get('url') flowed straight into fetch().
// No allowlist, no validator, no hardcoded host → flag.
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const upstream = await fetch(target);
  return new Response(await upstream.text());
}

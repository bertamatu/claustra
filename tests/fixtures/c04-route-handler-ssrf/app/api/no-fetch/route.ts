// No fetch sink - handler reads tainted data and echoes it back. C4
// only fires when tainted data reaches a network sink, so this must
// not flag.
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  return new Response(`got: ${target}`);
}

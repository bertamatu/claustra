// Validator helper named to match the validate*Url regex.
import { isAllowedUrl } from '../../../../lib/shims';

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  if (!isAllowedUrl(target)) return new Response('forbidden', { status: 403 });
  const r = await fetch(target);
  return new Response(await r.text());
}

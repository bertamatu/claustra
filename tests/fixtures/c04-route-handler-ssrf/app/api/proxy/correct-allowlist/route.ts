// Allowlist-via-includes against URL.hostname → counts as guard.
import { ALLOWED_HOSTS } from '../../../../lib/shims';

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  if (!ALLOWED_HOSTS.includes(new URL(target).hostname)) {
    return new Response('forbidden', { status: 403 });
  }
  const r = await fetch(target);
  return new Response(await r.text());
}

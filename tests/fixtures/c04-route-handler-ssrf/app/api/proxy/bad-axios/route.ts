// Source: searchParams.get + axios sink. No guard.
import { axios } from '../../../../lib/shims';

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  const r = await axios.get(target);
  return Response.json(r);
}

// Source: searchParams.get('src'); sink: new ImageResponse({ src }).
import { ImageResponse } from '../../../../lib/shims';

export function GET(request: Request): Response {
  const src = new URL(request.url).searchParams.get('src') ?? '';
  return new ImageResponse({ src }) as unknown as Response;
}

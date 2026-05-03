// Next.js metadata-convention file. Runs server-side at build/request time;
// never hydrates. claustra D1 must skip it even though `new Date()` and
// `Date.now()` appear in render scope.
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://example.com/', lastModified: new Date() },
    { url: 'https://example.com/blog', lastModified: new Date(Date.now()) },
  ];
}

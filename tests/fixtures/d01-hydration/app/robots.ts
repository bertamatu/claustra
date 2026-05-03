// Next.js metadata-convention file. Same exemption as sitemap.ts.
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  // Math.random() in a metadata file should not be flagged either.
  const _seed = Math.random();
  void _seed;
  return { rules: [{ userAgent: '*', allow: '/' }] };
}

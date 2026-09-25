import type { MetadataRoute } from 'next';

/** An internal tool: no crawler has any business here. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}

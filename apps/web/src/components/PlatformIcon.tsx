import type { JSX } from 'react';

/**
 * Brand glyphs for the scheduling filters and calendar chips. Drawn inline
 * rather than pulled from an icon package: there are exactly two, both are
 * simple, and shipping them as SVG means the Instagram gradient can be a real
 * gradient that greys out with a CSS filter instead of two separate assets.
 *
 * Colour lives in the markup (a gradient/solid fill), and the *unselected*
 * state is produced by `filter: grayscale(1)` in globals.css — one source of
 * truth for the artwork, with the on/off state expressed purely as styling.
 */

export interface PlatformIconProps {
  size?: number;
}

export function InstagramIcon({ size = 20 }: PlatformIconProps): JSX.Element {
  // A stable id per render would collide if two icons mounted at once, so the
  // gradient is referenced by a fixed id — identical definitions are fine,
  // the last one in the document wins and they are the same gradient.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="eve-ig-gradient" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FEDA75" />
          <stop offset="25%" stopColor="#FA7E1E" />
          <stop offset="50%" stopColor="#D62976" />
          <stop offset="75%" stopColor="#962FBF" />
          <stop offset="100%" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#eve-ig-gradient)" />
      <rect x="6" y="6" width="12" height="12" rx="4" stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="3" stroke="#fff" strokeWidth="1.6" />
      <circle cx="17" cy="7" r="1.1" fill="#fff" />
    </svg>
  );
}

export function FacebookIcon({ size = 20 }: PlatformIconProps): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="6" fill="#1877F2" />
      <path
        d="M15.2 12.3h-2v6.2h-2.6v-6.2H9.2v-2.2h1.4V8.8c0-1.7 1-2.9 2.9-2.9h1.9v2.2h-1.3c-.6 0-.9.3-.9.9v1.1h2.2l-.2 2.2Z"
        fill="#fff"
      />
    </svg>
  );
}

export function PlatformIcon({ platform, size }: { platform: 'instagram' | 'facebook'; size?: number }): JSX.Element {
  return platform === 'instagram' ? <InstagramIcon size={size} /> : <FacebookIcon size={size} />;
}

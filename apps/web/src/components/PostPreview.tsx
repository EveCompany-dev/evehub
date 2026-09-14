import type { JSX } from 'react';

export interface PostPreviewProps {
  platform: 'instagram' | 'facebook';
  postType: 'feed' | 'story';
  accountLabel: string;
  caption: string;
  mediaUrl: string | null;
}

function initialsFrom(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (label || '?').slice(0, 2).toUpperCase();
}

function HeartIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 20s-7-4.35-9.5-8.6C.7 8 2.2 4.5 5.6 4c2-.3 3.7.6 4.9 2.2l1.5 2 1.5-2C14.7 4.6 16.4 3.7 18.4 4c3.4.5 4.9 4 3.1 7.4C19 15.65 12 20 12 20Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CommentIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9A2.5 2.5 0 0 1 17.5 17H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 14.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShareIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11.5 21 4l-6.5 18-3-8-8.5-2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function BookmarkIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3.5h12v17l-6-4-6 4v-17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function ThumbsUpIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 11v9H4v-9h3Zm3 9h7.5a2 2 0 0 0 2-1.7l1-6a2 2 0 0 0-2-2.3H14l.6-3.6a1.8 1.8 0 0 0-3.2-1.4L8 9v11h2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Purely visual mock of how a post will actually look on Instagram/Facebook,
 * feed or story — driven directly by the editor's own state, so there's no
 * separate "sync" step: it re-renders on every keystroke/upload like any
 * other prop.
 */
export function PostPreview({ platform, postType, accountLabel, caption, mediaUrl }: PostPreviewProps): JSX.Element {
  const label = accountLabel || (platform === 'instagram' ? 'sua_conta' : 'Sua Página');
  const avatar = (
    <span className="eve-preview__avatar" aria-hidden="true">
      {initialsFrom(label)}
    </span>
  );
  const media = mediaUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- external/uploaded URL, not a static asset next/image can optimize.
    <img src={mediaUrl} alt="" />
  ) : (
    <div className="eve-preview__placeholder">Escolha uma imagem</div>
  );

  if (postType === 'story') {
    return (
      <div className={`eve-preview eve-preview--story is-${platform}`}>
        <div className="eve-preview__story-progress">
          <span />
        </div>
        <div className="eve-preview__story-head">
          {avatar}
          <span className="eve-preview__story-name">{label}</span>
          <span className="eve-dim">agora</span>
        </div>
        <div className="eve-preview__story-media">{media}</div>
        <div className="eve-preview__story-reply">{platform === 'instagram' ? 'Enviar mensagem' : 'Responder'}</div>
      </div>
    );
  }

  if (platform === 'instagram') {
    return (
      <div className="eve-preview eve-preview--ig-feed">
        <div className="eve-preview__head">
          {avatar}
          <span className="eve-preview__name">{label}</span>
          <span className="eve-preview__dots">···</span>
        </div>
        <div className="eve-preview__media">{media}</div>
        <div className="eve-preview__actions">
          <HeartIcon />
          <CommentIcon />
          <ShareIcon />
          <span className="eve-preview__bookmark">
            <BookmarkIcon />
          </span>
        </div>
        <p className="eve-preview__likes">0 curtidas</p>
        <p className="eve-preview__caption">
          <strong>{label}</strong> {caption || <span className="eve-dim">Sua legenda aparece aqui...</span>}
        </p>
        <p className="eve-dim eve-preview__time">agora mesmo</p>
      </div>
    );
  }

  return (
    <div className="eve-preview eve-preview--fb-feed">
      <div className="eve-preview__head">
        {avatar}
        <div className="eve-preview__fb-identity">
          <span className="eve-preview__name">{label}</span>
          <span className="eve-dim eve-preview__meta">agora · 🌐</span>
        </div>
      </div>
      <p className="eve-preview__caption eve-preview__caption--fb">
        {caption || <span className="eve-dim">Sua legenda aparece aqui...</span>}
      </p>
      <div className="eve-preview__media">{media}</div>
      <div className="eve-preview__actions eve-preview__actions--fb">
        <span>
          <ThumbsUpIcon /> Curtir
        </span>
        <span>
          <CommentIcon /> Comentar
        </span>
        <span>
          <ShareIcon /> Compartilhar
        </span>
      </div>
    </div>
  );
}

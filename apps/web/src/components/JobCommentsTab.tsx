'use client';

import { strings, X } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { linkify } from './Linkify';
import { formatDateTimePtBr, memberInitials, memberLabel, type JobCommentSummary } from './job-types';

export interface JobCommentsTabProps {
  jobId: string;
  currentUserId: string;
}

interface CommentsResponse {
  comments?: JobCommentSummary[];
  error?: string;
}

export function JobCommentsTab({ jobId, currentUserId }: JobCommentsTabProps): JSX.Element {
  const [comments, setComments] = useState<JobCommentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/jobs/${jobId}/comments`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as CommentsResponse;
      if (!response.ok || !body.comments) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setComments(body.comments);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const send = async () => {
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { comment?: JobCommentSummary; error?: string };
      if (!response.ok || !body.comment) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setComments((current) => [...current, body.comment!]);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const remove = async (commentId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/comments/${commentId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setComments((current) => current.filter((comment) => comment.id !== commentId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (loading) return <p className="eve-dim">Carregando...</p>;

  return (
    <div className="eve-jobs__comments">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-jobs__comment-list">
        {comments.length === 0 && <p className="eve-dim">{strings.jobs.commentsEmpty}</p>}
        {comments.map((comment) => (
          <div key={comment.id} className="eve-jobs__comment">
            <span className="eve-avatar eve-avatar--fallback" style={{ width: 24, height: 24, fontSize: 10 }}>
              {memberInitials(comment.author)}
            </span>
            <div className="eve-jobs__comment-body">
              <div className="eve-jobs__comment-meta">
                <span className="eve-jobs__comment-author">{memberLabel(comment.author)}</span>
                <span className="eve-dim">{formatDateTimePtBr(comment.createdAt)}</span>
              </div>
              <p>{linkify(comment.body)}</p>
            </div>
            {comment.authorId === currentUserId && (
              <button
                type="button"
                className="eve-btn eve-btn--icon"
                title={strings.jobs.deleteComment}
                onClick={() => void remove(comment.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="eve-jobs__comment-composer">
        <textarea
          className="eve-input"
          rows={2}
          placeholder={strings.jobs.commentPlaceholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="eve-btn eve-btn--primary" disabled={sending} onClick={() => void send()}>
          {strings.jobs.commentSend}
        </button>
      </div>
    </div>
  );
}

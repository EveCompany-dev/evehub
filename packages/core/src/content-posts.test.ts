import { describe, expect, it } from 'vitest';
import { CONTENT_STATUS, contentDate, contentRowChanges, contentRowPatch, contentStatusFor } from './content-posts';

const at = (iso: string) => new Date(iso);
const post = (status: 'scheduled' | 'publishing' | 'published' | 'failed', when = '2026-09-24T13:00:00.000Z', permalink: string | null = null) => ({
  status,
  scheduledFor: at(when),
  permalink,
});

describe('contentStatusFor', () => {
  it('is nothing without posts', () => {
    expect(contentStatusFor([])).toBeNull();
  });

  it('stays Programado until Meta confirms every post', () => {
    expect(contentStatusFor([post('scheduled')])).toBe(CONTENT_STATUS.scheduled);
    expect(contentStatusFor([post('publishing')])).toBe(CONTENT_STATUS.scheduled);
    expect(contentStatusFor([post('published'), post('scheduled')])).toBe(CONTENT_STATUS.scheduled);
  });

  it('says Publicado only when all of them went out', () => {
    expect(contentStatusFor([post('published'), post('published')])).toBe(CONTENT_STATUS.published);
  });

  it('says Falhou as soon as one fails', () => {
    expect(contentStatusFor([post('published'), post('failed')])).toBe(CONTENT_STATUS.failed);
  });
});

describe('contentDate', () => {
  it('uses the São Paulo day, not the UTC one', () => {
    // 22:30 in São Paulo is already the next day in UTC.
    expect(contentDate(at('2026-09-23T01:30:00.000Z'))).toBe('2026-09-22');
    expect(contentDate(at('2026-09-23T12:00:00.000Z'))).toBe('2026-09-23');
  });
});

describe('contentRowPatch', () => {
  const row = { titulo: 'Reels do café', status: 'Em aprovação', data: '2026-09-20', link: '' };

  it('marks the row Programado on the day of its earliest post', () => {
    expect(contentRowPatch(row, [post('scheduled', '2026-09-26T13:00:00.000Z'), post('scheduled', '2026-09-25T13:00:00.000Z')])).toEqual({
      ...row,
      status: 'Programado',
      data: '2026-09-25',
    });
  });

  it('fills an empty link once published, and never overwrites one the team typed', () => {
    const published = [post('published', '2026-09-24T13:00:00.000Z', 'https://www.instagram.com/p/abc/')];
    expect(contentRowPatch(row, published)).toMatchObject({ status: 'Publicado', link: 'https://www.instagram.com/p/abc/' });
    expect(contentRowPatch({ ...row, link: 'https://meu.link' }, published)).toMatchObject({ link: 'https://meu.link' });
  });

  it('keeps the title and everything else as written', () => {
    expect(contentRowPatch(row, [post('scheduled')])!.titulo).toBe('Reels do café');
  });

  it('sends a row back to Em aprovação when its last post is cancelled', () => {
    expect(contentRowPatch({ ...row, status: 'Programado' }, [])).toMatchObject({ status: 'Em aprovação' });
  });

  it('leaves a row alone when it has no posts and a status the team chose', () => {
    expect(contentRowPatch({ ...row, status: 'Ideia' }, [])).toBeNull();
  });

  it('reports no change when the row already says it', () => {
    expect(contentRowPatch({ ...row, status: 'Programado', data: '2026-09-24' }, [post('scheduled')])).toBeNull();
  });
});

describe('contentRowChanges', () => {
  it('returns only the keys it owns that change, never the rest of the row', () => {
    const row = { titulo: 'Reels do café', roteiro: 'texto', status: 'Em aprovação', data: '2026-09-20' };
    expect(contentRowChanges(row, [{ status: 'scheduled', scheduledFor: new Date('2026-09-25T13:00:00.000Z'), permalink: null }])).toEqual({
      status: 'Programado',
      data: '2026-09-25',
    });
  });

  it('is null when nothing changes', () => {
    const row = { status: 'Programado', data: '2026-09-25' };
    expect(contentRowChanges(row, [{ status: 'scheduled', scheduledFor: new Date('2026-09-25T13:00:00.000Z'), permalink: null }])).toBeNull();
  });
});

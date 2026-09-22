'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Avatar } from '../app/perfil/ProfileForm';
import { ACTIVITY_AREAS, areaForAction } from '../lib/activity-areas';

interface ActivityEntry {
  id: string;
  actorId: string | null;
  actorLabel: string;
  actorImage: string | null;
  actorRemoved: boolean;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

interface ActivityPage {
  entries?: ActivityEntry[];
  nextCursor?: string | null;
  actors?: { id: string; label: string }[];
  error?: string;
}

interface Filters {
  area: string;
  actorId: string;
  from: string;
  to: string;
  q: string;
}

const EMPTY_FILTERS: Filters = { area: '', actorId: '', from: '', to: '', q: '' };

/** Onde a linha leva, quando o que foi tocado tem pagina propria. */
function entityHref(entry: ActivityEntry): string | null {
  if (!entry.entityId) return null;
  if (entry.entityType === 'job') return `/jobs?job=${entry.entityId}`;
  if (entry.entityType === 'client') return `/clients/${entry.entityId}`;
  if (entry.entityType === 'project') return `/projects/${entry.entityId}`;
  return null;
}

function dayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return 'Hoje';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function queryString(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

/**
 * O registro de atividades dos admins: quem fez o que, quando, no que e do
 * time. Conversa privada nunca aparece aqui — ela nem e gravada.
 */
export function ActivityLogWorkspace(): JSX.Element {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // O texto livre espera a pessoa parar de digitar antes de buscar.
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [actors, setActors] = useState<{ id: string; label: string }[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(async (active: Filters, cursor: string | null): Promise<ActivityPage | null> => {
    try {
      const response = await fetch(`/api/activity?${queryString(active, cursor)}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as ActivityPage;
      if (!response.ok || !body.entries) {
        setError(body.error ?? `HTTP ${response.status}`);
        return null;
      }
      setError(null);
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void fetchPage(filters, null).then((body) => {
      if (cancelled) return;
      setLoading(false);
      if (!body) return;
      setEntries(body.entries ?? []);
      setNextCursor(body.nextCursor ?? null);
      if (body.actors) setActors(body.actors);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, filters]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const body = await fetchPage(filters, nextCursor);
    setLoadingMore(false);
    if (!body) return;
    setEntries((current) => [...current, ...(body.entries ?? [])]);
    setNextCursor(body.nextCursor ?? null);
  };

  const groups = useMemo(() => {
    const result: { key: string; label: string; items: ActivityEntry[] }[] = [];
    for (const entry of entries) {
      const key = dayKey(entry.createdAt);
      const last = result[result.length - 1];
      if (last && last.key === key) last.items.push(entry);
      else result.push({ key, label: dayLabel(entry.createdAt), items: [entry] });
    }
    return result;
  }, [entries]);

  const filtered = Object.values({ ...filters, q: search }).some(Boolean);
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="eve-activity">
      <p className="eve-dim eve-activity__hint">
        Tudo o que alguém faz no que é do time — jobs, tabelas, clientes, financeiro, agenda, conectores, chat da equipe,
        equipe e senhas. Conversas privadas e o chat de IA não são registrados. Só administradores veem esta página.
      </p>

      <div className="eve-activity__filters">
        <input
          className="eve-input eve-activity__search"
          type="search"
          placeholder="Buscar no registro…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="eve-input" value={filters.area} onChange={(event) => set({ area: event.target.value })} aria-label="Área">
          <option value="">Todas as áreas</option>
          {ACTIVITY_AREAS.map((area) => (
            <option key={area.key} value={area.key}>
              {area.label}
            </option>
          ))}
        </select>
        <select className="eve-input" value={filters.actorId} onChange={(event) => set({ actorId: event.target.value })} aria-label="Pessoa">
          <option value="">Todas as pessoas</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.label}
            </option>
          ))}
        </select>
        <label className="eve-activity__date">
          <span className="eve-dim">de</span>
          <input className="eve-input" type="date" value={filters.from} onChange={(event) => set({ from: event.target.value })} />
        </label>
        <label className="eve-activity__date">
          <span className="eve-dim">até</span>
          <input className="eve-input" type="date" value={filters.to} onChange={(event) => set({ to: event.target.value })} />
        </label>
        {filtered && (
          <button
            type="button"
            className="eve-btn"
            onClick={() => {
              setSearch('');
              setFilters(EMPTY_FILTERS);
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : entries.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">{filtered ? 'Nada encontrado com esses filtros.' : 'Nenhuma atividade registrada ainda.'}</p>
        </div>
      ) : (
        <div className="eve-activity__days">
          {groups.map((group) => (
            <section key={group.key} className="eve-activity__day">
              <h2 className="eve-activity__day-label">{group.label}</h2>
              <ul className="eve-activity__list">
                {group.items.map((entry) => {
                  const href = entityHref(entry);
                  const area = areaForAction(entry.action);
                  return (
                    <li key={entry.id} className="eve-activity__row">
                      <span className="eve-activity__time eve-dim">{timeLabel(entry.createdAt)}</span>
                      <Avatar name={entry.actorLabel} email={entry.actorLabel} image={entry.actorImage} size={24} />
                      <span className="eve-activity__text">
                        <strong>{entry.actorLabel}</strong>
                        {entry.actorRemoved && <span className="eve-dim"> (conta removida)</span>} {entry.summary}
                        {href && (
                          <>
                            {' · '}
                            <Link href={href} className="eve-activity__link">
                              abrir
                            </Link>
                          </>
                        )}
                      </span>
                      {area && <span className="eve-activity__area">{area.label}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {nextCursor && (
            <button type="button" className="eve-btn eve-activity__more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? 'Carregando…' : 'Carregar mais'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

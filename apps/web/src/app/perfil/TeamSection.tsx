'use client';

import { strings } from '@eve/ui';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { TAB_KEYS } from '../../lib/permissions';
import { Avatar } from './ProfileForm';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  isOwner: boolean;
  isSocialMedia: boolean;
  disabled: boolean;
  hasPassword: boolean;
  lastSeenAt: string | null;
  roleId: string | null;
  roleName: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  tabs: string[];
}

const TAB_LABELS: Record<string, string> = {
  chat: 'Chat',
  jobs: 'Jobs',
  tables: 'Tabelas',
  connectors: 'Conectores',
  automations: 'Automações',
  scheduling: 'Agenda',
  financial: 'Financeiro',
  team: 'Equipe',
};

export interface TeamSectionProps {
  currentUserId: string;
  /**
   * Full management (add/promote/disable people, create/edit/delete Roles)
   * is owner-only. A non-owner only reaches this component at all via a
   * Role granting the 'team' tab, and gets a read-only roster — see
   * lib/permissions.ts's canManageTeam vs canViewTeamTab split.
   */
  isOwner: boolean;
}

/**
 * Gestao de equipe.
 *
 * O componente nao decide nada sozinho: cada acao passa pela API, que reavalia
 * a permissao e as travas (ultimo owner, autodesativacao). Esconder o botao e
 * cortesia com o usuario, nao controle de acesso.
 */
export function TeamSection({ currentUserId, isOwner }: TeamSectionProps): JSX.Element {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', password: '', isOwner: false });

  /**
   * Id da conta com o "apagar" armado. Dois cliques em vez de um confirm()
   * nativo: o dialog do browser trava a aba inteira e nao da para testar.
   */
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [managingRoles, setManagingRoles] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<{ name: string; tabs: Set<string> }>({ name: '', tabs: new Set() });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/users', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { users?: TeamMember[]; error?: string };
      if (!response.ok || !body.users) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setMembers(body.users);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    if (!isOwner) return;
    try {
      const response = await fetch('/api/roles', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { roles?: RoleRow[]; error?: string };
      if (response.ok && body.roles) setRoles(body.roles);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [isOwner]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadRoles();
  }, [load, loadRoles]);

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          password: draft.password || undefined,
          isOwner: draft.isOwner,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setDraft({ name: '', email: '', password: '', isOwner: false });
      setAdding(false);
      setNotice(strings.team.added);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, changes: { isOwner?: boolean; disabled?: boolean; roleId?: string | null }) => {
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });

    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      // 409 aqui e uma trava proposital (ultimo owner), nao uma falha.
      setError(body.error ?? `HTTP ${response.status}`);
      return;
    }
    await load();
  };

  /** Apaga de vez. A API recusa se a conta ainda estiver ativa ou se houver conteudo dela no workspace. */
  const removeMember = async (id: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);

    try {
      const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        // 409 aqui e uma trava proposital (conteudo no workspace), nao uma falha.
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setNotice(strings.team.removed);
      await load();
    } finally {
      setConfirmingRemoveId(null);
      setBusy(false);
    }
  };

  const resetRoleDraft = () => {
    setEditingRoleId(null);
    setRoleDraft({ name: '', tabs: new Set() });
  };

  const startEditRole = (role: RoleRow) => {
    setEditingRoleId(role.id);
    setRoleDraft({ name: role.name, tabs: new Set(role.tabs) });
  };

  const toggleDraftTab = (tab: string) => {
    setRoleDraft((current) => {
      const next = new Set(current.tabs);
      if (next.has(tab)) next.delete(tab);
      else next.add(tab);
      return { ...current, tabs: next };
    });
  };

  const submitRole = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!roleDraft.name.trim()) return;
    setRoleBusy(true);
    setError(null);

    try {
      const response = editingRoleId
        ? await fetch(`/api/roles/${editingRoleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roleDraft.name.trim(), tabs: [...roleDraft.tabs] }),
          })
        : await fetch('/api/roles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: roleDraft.name.trim(), tabs: [...roleDraft.tabs] }),
          });

      const body = (await response.json().catch(() => ({}))) as { role?: RoleRow; error?: string };
      if (!response.ok || !body.role) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      const saved = body.role;
      setRoles((current) => {
        const next = editingRoleId ? current.map((role) => (role.id === editingRoleId ? saved : role)) : [...current, saved];
        return next.sort((a, b) => a.name.localeCompare(b.name));
      });
      resetRoleDraft();
    } finally {
      setRoleBusy(false);
    }
  };

  const deleteRole = async (id: string) => {
    setRoleBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setRoles((current) => current.filter((role) => role.id !== id));
      // Members with this role fall back to the default tab set (SetNull) — reflect that in the roster.
      await load();
    } finally {
      setRoleBusy(false);
    }
  };

  return (
    <section className="eve-card">
      <div className="eve-team__head">
        <h2 className="eve-card__title">{strings.team.title}</h2>
        {isOwner && (
          <button type="button" className="eve-btn" onClick={() => setAdding((value) => !value)}>
            {adding ? strings.team.cancel : strings.team.add}
          </button>
        )}
      </div>

      <p className="eve-dim eve-profile__hint">{strings.team.hint}</p>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}
      {notice && <p className="eve-alert">{notice}</p>}

      {adding && isOwner && (
        <form className="eve-team__form" onSubmit={(event) => void addMember(event)}>
          <label className="eve-field">
            <span className="eve-field__label">{strings.team.name}</span>
            <input
              className="eve-input"
              required
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.team.email}</span>
            <input
              className="eve-input"
              type="email"
              required
              value={draft.email}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </label>

          <label className="eve-field">
            <span className="eve-field__label">{strings.team.password}</span>
            <input
              className="eve-input"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
            <span className="eve-setup__hint">{strings.team.passwordHint}</span>
          </label>

          <label className="eve-check">
            <input
              type="checkbox"
              checked={draft.isOwner}
              onChange={(event) => setDraft({ ...draft, isOwner: event.target.checked })}
            />
            <span>{strings.team.makeOwner}</span>
          </label>

          <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
            {busy ? strings.team.adding : strings.team.confirmAdd}
          </button>
        </form>
      )}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : (
        <ul className="eve-team__list">
          {members.map((member) => (
            <li key={member.id} className={member.disabled ? 'eve-team__row is-disabled' : 'eve-team__row'}>
              <Avatar name={member.name} email={member.email} image={member.image} size={36} />

              <span className="eve-team__who">
                <span className="eve-team__name">
                  {member.name ?? member.email}
                  {member.id === currentUserId && <span className="eve-dim"> · {strings.team.you}</span>}
                </span>
                <span className="eve-dim">{member.email}</span>
                <span className="eve-dim eve-team__meta">
                  {member.isOwner ? strings.team.owner : strings.team.member}
                  {member.isSocialMedia ? ` · ${strings.team.socialMedia}` : ''}
                  {member.roleName ? ` · ${member.roleName}` : ''}
                  {' · '}
                  {member.hasPassword ? strings.team.hasPassword : strings.team.googleOnly}
                  {member.disabled ? ` · ${strings.team.disabled}` : ''}
                </span>
              </span>

              {isOwner && (
                <span className="eve-team__actions">
                  {!member.isOwner && (
                    <select
                      className="eve-input eve-team__role-select"
                      value={member.roleId ?? ''}
                      onChange={(event) => void patch(member.id, { roleId: event.target.value || null })}
                    >
                      <option value="">Sem cargo</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {/* So rebaixa. Dar admin e decisao da criacao da conta — ver validateOwnerGrant. */}
                  {member.isOwner && (
                    <button type="button" className="eve-btn" onClick={() => void patch(member.id, { isOwner: false })}>
                      {strings.team.demote}
                    </button>
                  )}
                  <button
                    type="button"
                    className="eve-btn"
                    onClick={() => void patch(member.id, { disabled: !member.disabled })}
                  >
                    {member.disabled ? strings.team.enable : strings.team.disable}
                  </button>
                  {/* Apagar so aparece depois de desativar: desativar e reversivel, apagar nao. */}
                  {member.disabled &&
                    member.id !== currentUserId &&
                    (confirmingRemoveId === member.id ? (
                      <>
                        <button
                          type="button"
                          className="eve-btn eve-btn--danger"
                          disabled={busy}
                          onClick={() => void removeMember(member.id)}
                        >
                          {strings.team.confirmRemoveYes}
                        </button>
                        <button type="button" className="eve-btn" onClick={() => setConfirmingRemoveId(null)}>
                          {strings.team.cancel}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="eve-btn eve-btn--danger"
                        onClick={() => setConfirmingRemoveId(member.id)}
                      >
                        {strings.team.remove}
                      </button>
                    ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <div className="eve-team__roles">
          <div className="eve-team__head">
            <h3 className="eve-card__title">Cargos</h3>
            <button
              type="button"
              className="eve-btn"
              onClick={() => {
                setManagingRoles((value) => !value);
                resetRoleDraft();
              }}
            >
              {managingRoles ? strings.team.cancel : 'Gerenciar cargos'}
            </button>
          </div>

          {managingRoles && (
            <>
              <p className="eve-dim eve-profile__hint">
                Um cargo concede acesso extra a abas, alem do conjunto padrão (Chat, Jobs, Tabelas, Conectores,
                Automações).
              </p>

              {roles.length > 0 && (
                <ul className="eve-team__role-list">
                  {roles.map((role) => (
                    <li key={role.id} className="eve-team__role-row">
                      <span className="eve-team__role-name">{role.name}</span>
                      <span className="eve-dim eve-team__role-tabs">
                        {role.tabs.length > 0 ? role.tabs.map((tab) => TAB_LABELS[tab] ?? tab).join(', ') : 'Nenhuma aba extra'}
                      </span>
                      <span className="eve-team__actions">
                        <button type="button" className="eve-btn" onClick={() => startEditRole(role)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="eve-btn eve-btn--danger"
                          disabled={roleBusy}
                          onClick={() => void deleteRole(role.id)}
                        >
                          Apagar
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <form className="eve-team__form" onSubmit={(event) => void submitRole(event)}>
                <label className="eve-field">
                  <span className="eve-field__label">Nome do cargo</span>
                  <input
                    className="eve-input"
                    required
                    value={roleDraft.name}
                    onChange={(event) => setRoleDraft((current) => ({ ...current, name: event.target.value }))}
                  />
                </label>

                <div className="eve-field">
                  <span className="eve-field__label">Abas visíveis</span>
                  <div className="eve-team__role-tabs-grid">
                    {TAB_KEYS.map((tab) => (
                      <label key={tab} className="eve-check">
                        <input type="checkbox" checked={roleDraft.tabs.has(tab)} onChange={() => toggleDraftTab(tab)} />
                        <span>{TAB_LABELS[tab] ?? tab}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="eve-profile__actions">
                  <button type="submit" className="eve-btn eve-btn--primary" disabled={roleBusy}>
                    {editingRoleId ? 'Salvar cargo' : 'Criar cargo'}
                  </button>
                  {editingRoleId && (
                    <button type="button" className="eve-btn" onClick={resetRoleDraft}>
                      {strings.team.cancel}
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

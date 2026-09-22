'use client';

import { Copy, KeyRound, strings } from '@eve/ui';
import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { ROLE_GRANTABLE_TABS } from '../../lib/permissions';
import { Avatar } from './ProfileForm';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  /** Admin — derived from the fixed e-mail list, never a toggle. */
  isOwner: boolean;
  isSocialMedia: boolean;
  disabled: boolean;
  /** null for non-admin viewers: account details aren't theirs to see. */
  hasPassword: boolean | null;
  lastSeenAt: string | null;
  roleId: string | null;
  roleName: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  tabs: string[];
}

interface ResetRequest {
  id: string;
  createdAt: string;
  user: { id: string; name: string | null; email: string; image: string | null };
}

interface IssuedLink {
  who: string;
  url: string;
  expiresAt: string;
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
   * Admin (one of the fixed admin e-mails). Everyone else reaches this
   * component through the default 'team' tab and gets a read-only roster —
   * they see each other, they can't act on each other.
   */
  isOwner: boolean;
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

function whoOf(member: { name: string | null; email: string }): string {
  return member.name?.trim() || member.email;
}

/**
 * Gestao de equipe.
 *
 * O componente nao decide nada sozinho: cada acao passa pela API, que reavalia
 * a permissao e as travas (conta de admin, autodesativacao). Esconder o botao
 * e cortesia com o usuario, nao controle de acesso.
 */
export function TeamSection({ currentUserId, isOwner }: TeamSectionProps): JSX.Element {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', password: '' });

  /**
   * Id da conta com o "apagar" armado. Dois cliques em vez de um confirm()
   * nativo: o dialog do browser trava a aba inteira e nao da para testar.
   */
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ name: '', email: '', isSocialMedia: false });

  const [resetRequests, setResetRequests] = useState<ResetRequest[]>([]);
  const [issuedLink, setIssuedLink] = useState<IssuedLink | null>(null);
  const [copied, setCopied] = useState(false);

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [managingRoles, setManagingRoles] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<{ name: string; tabs: Set<string> }>({ name: '', tabs: new Set() });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/users', { cache: 'no-store' });
      const body = await readJson<{ users?: TeamMember[] }>(response);
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

  const loadAdminData = useCallback(async () => {
    if (!isOwner) return;
    try {
      const [rolesResponse, resetsResponse] = await Promise.all([
        fetch('/api/roles', { cache: 'no-store' }),
        fetch('/api/password-resets', { cache: 'no-store' }),
      ]);
      const rolesBody = await readJson<{ roles?: RoleRow[] }>(rolesResponse);
      if (rolesResponse.ok && rolesBody.roles) setRoles(rolesBody.roles);
      const resetsBody = await readJson<{ requests?: ResetRequest[] }>(resetsResponse);
      if (resetsResponse.ok && resetsBody.requests) setResetRequests(resetsBody.requests);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [isOwner]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void loadAdminData();
  }, [load, loadAdminData]);

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    clearMessages();

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: draft.name, email: draft.email, password: draft.password || undefined }),
      });

      const body = await readJson<object>(response);
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setDraft({ name: '', email: '', password: '' });
      setAdding(false);
      setNotice(strings.team.added);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const patch = async (
    id: string,
    changes: { name?: string; email?: string; isSocialMedia?: boolean; disabled?: boolean; roleId?: string | null },
  ): Promise<boolean> => {
    clearMessages();

    const response = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });

    const body = await readJson<object>(response);
    if (!response.ok) {
      // 409 aqui e uma trava proposital (conta de admin, e-mail em uso), nao uma falha.
      setError(body.error ?? `HTTP ${response.status}`);
      return false;
    }
    await load();
    return true;
  };

  const startEdit = (member: TeamMember) => {
    setEditingId(member.id);
    setEditDraft({ name: member.name ?? '', email: member.email, isSocialMedia: member.isSocialMedia });
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>, member: TeamMember) => {
    event.preventDefault();
    setBusy(true);
    try {
      const saved = await patch(member.id, {
        name: editDraft.name,
        ...(member.isOwner ? {} : { email: editDraft.email }),
        isSocialMedia: editDraft.isSocialMedia,
      });
      if (saved) setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  /** Apaga de vez. A API recusa conta ativa e conta de admin. */
  const removeMember = async (member: TeamMember) => {
    clearMessages();
    setBusy(true);

    try {
      const response = await fetch(`/api/users/${member.id}`, { method: 'DELETE' });
      const body = await readJson<object>(response);
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setNotice(`Conta de ${whoOf(member)} apagada. O trabalho no workspace continua, assinado só com o nome.`);
      await load();
    } finally {
      setConfirmingRemoveId(null);
      setBusy(false);
    }
  };

  const issueResetLink = async (user: { id: string; name: string | null; email: string }) => {
    clearMessages();
    setBusy(true);
    setCopied(false);
    try {
      const response = await fetch(`/api/users/${user.id}/password-reset`, { method: 'POST' });
      const body = await readJson<{ path?: string; expiresAt?: string }>(response);
      if (!response.ok || !body.path || !body.expiresAt) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setIssuedLink({ who: whoOf(user), url: `${window.location.origin}${body.path}`, expiresAt: body.expiresAt });
      setResetRequests((current) => current.filter((request) => request.user.id !== user.id));
    } finally {
      setBusy(false);
    }
  };

  const dismissResetRequest = async (id: string) => {
    clearMessages();
    const response = await fetch(`/api/password-resets/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await readJson<object>(response);
      setError(body.error ?? `HTTP ${response.status}`);
      return;
    }
    setResetRequests((current) => current.filter((request) => request.id !== id));
  };

  const copyLink = async () => {
    if (!issuedLink) return;
    try {
      await navigator.clipboard.writeText(issuedLink.url);
      setCopied(true);
    } catch {
      // Clipboard bloqueado (http sem TLS, permissao): o campo ja esta selecionavel.
      setCopied(false);
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

      const body = await readJson<{ role?: RoleRow }>(response);
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
        const body = await readJson<object>(response);
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

      <p className="eve-dim eve-profile__hint">{isOwner ? strings.team.hint : strings.team.memberHint}</p>

      {error && <p className="eve-alert eve-alert--error">{error}</p>}
      {notice && <p className="eve-alert">{notice}</p>}

      {isOwner && resetRequests.length > 0 && (
        <div className="eve-team__resets">
          <p className="eve-team__resets-title">Pedidos de senha ({resetRequests.length})</p>
          {resetRequests.map((request) => (
            <div key={request.id} className="eve-team__reset-row">
              <Avatar name={request.user.name} email={request.user.email} image={request.user.image} size={24} />
              <span className="eve-team__who">
                <span className="eve-team__name">{whoOf(request.user)}</span>
                <span className="eve-dim">
                  pediu em {new Date(request.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </span>
              <span className="eve-team__actions">
                <button type="button" className="eve-btn eve-btn--primary" disabled={busy} onClick={() => void issueResetLink(request.user)}>
                  Gerar link
                </button>
                <button type="button" className="eve-btn" onClick={() => void dismissResetRequest(request.id)}>
                  Descartar
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {isOwner && issuedLink && (
        <div className="eve-team__link-box">
          <strong>Link de senha para {issuedLink.who}</strong>
          <div className="eve-team__link-row">
            <input className="eve-input" readOnly value={issuedLink.url} onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="eve-btn" onClick={() => void copyLink()}>
              <Copy size={14} aria-hidden="true" /> {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <span className="eve-dim">
            Mande para a pessoa (WhatsApp, por exemplo). Vale uma vez, até{' '}
            {new Date(issuedLink.expiresAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Este link
            não aparece de novo depois que você fechar este aviso.{' '}
          </span>
          <button type="button" className="eve-login__link" onClick={() => setIssuedLink(null)}>
            Fechar
          </button>
        </div>
      )}

      {adding && isOwner && (
        <form className="eve-team__form" onSubmit={(event) => void addMember(event)}>
          <label className="eve-field">
            <span className="eve-field__label">{strings.team.name}</span>
            <input className="eve-input" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
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

          <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
            {busy ? strings.team.adding : strings.team.confirmAdd}
          </button>
        </form>
      )}

      {loading ? (
        <p className="eve-dim">carregando...</p>
      ) : (
        <ul className="eve-team__list">
          {members.map((member) => {
            const isSelf = member.id === currentUserId;
            return (
              <li key={member.id} className={member.disabled ? 'eve-team__row is-disabled' : 'eve-team__row'}>
                <Avatar name={member.name} email={member.email} image={member.image} size={36} />

                <span className="eve-team__who">
                  <span className="eve-team__name">
                    {member.name ?? member.email}
                    {isSelf && <span className="eve-dim"> · {strings.team.you}</span>}
                  </span>
                  <span className="eve-dim">{member.email}</span>
                  <span className="eve-dim eve-team__meta">
                    {member.isOwner ? strings.team.owner : strings.team.member}
                    {member.isSocialMedia ? ` · ${strings.team.socialMedia}` : ''}
                    {member.roleName ? ` · ${member.roleName}` : ''}
                    {member.hasPassword === null ? '' : ` · ${member.hasPassword ? strings.team.hasPassword : strings.team.googleOnly}`}
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
                    <button type="button" className="eve-btn" onClick={() => (editingId === member.id ? setEditingId(null) : startEdit(member))}>
                      {editingId === member.id ? strings.team.cancel : 'Editar'}
                    </button>
                    {!isSelf && !member.disabled && (
                      <button type="button" className="eve-btn" disabled={busy} onClick={() => void issueResetLink(member)} title="Gerar um link para a pessoa criar uma senha nova">
                        <KeyRound size={14} aria-hidden="true" /> Link de senha
                      </button>
                    )}
                    {/* Conta de admin e fixa no codigo: nao se desativa nem se apaga por aqui. */}
                    {!member.isOwner && !isSelf && (
                      <button type="button" className="eve-btn" onClick={() => void patch(member.id, { disabled: !member.disabled })}>
                        {member.disabled ? strings.team.enable : strings.team.disable}
                      </button>
                    )}
                    {/* Apagar so aparece depois de desativar: desativar e reversivel, apagar nao. */}
                    {member.disabled &&
                      !member.isOwner &&
                      !isSelf &&
                      (confirmingRemoveId === member.id ? (
                        <>
                          <button type="button" className="eve-btn eve-btn--danger" disabled={busy} onClick={() => void removeMember(member)}>
                            {strings.team.confirmRemoveYes}
                          </button>
                          <button type="button" className="eve-btn" onClick={() => setConfirmingRemoveId(null)}>
                            {strings.team.cancel}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="eve-btn eve-btn--danger" onClick={() => setConfirmingRemoveId(member.id)}>
                          {strings.team.remove}
                        </button>
                      ))}
                  </span>
                )}

                {isOwner && confirmingRemoveId === member.id && (
                  <p className="eve-dim eve-profile__hint" style={{ width: '100%', margin: 0 }}>
                    Apagar tira o login, a senha, o Google vinculado, a foto, as notificações e o acesso de {whoOf(member)} para
                    sempre. Jobs, comentários e mensagens no chat da equipe continuam, assinados só com o nome.
                  </p>
                )}

                {isOwner && editingId === member.id && (
                  <form className="eve-team__edit" onSubmit={(event) => void saveEdit(event, member)}>
                    <label className="eve-field">
                      <span className="eve-field__label">{strings.team.name}</span>
                      <input
                        className="eve-input"
                        required
                        value={editDraft.name}
                        onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
                      />
                    </label>
                    <label className="eve-field">
                      <span className="eve-field__label">{strings.team.email}</span>
                      <input
                        className="eve-input"
                        type="email"
                        required
                        disabled={member.isOwner}
                        title={member.isOwner ? 'E-mail de administrador é fixo.' : undefined}
                        value={editDraft.email}
                        onChange={(event) => setEditDraft({ ...editDraft, email: event.target.value })}
                      />
                    </label>
                    <label className="eve-check">
                      <input
                        type="checkbox"
                        checked={editDraft.isSocialMedia}
                        onChange={(event) => setEditDraft({ ...editDraft, isSocialMedia: event.target.checked })}
                      />
                      <span>{strings.team.socialMedia}</span>
                    </label>
                    <button type="submit" className="eve-btn eve-btn--primary" disabled={busy}>
                      Salvar
                    </button>
                  </form>
                )}
              </li>
            );
          })}
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
                Um cargo concede acesso extra a abas, além do conjunto padrão (Chat, Jobs, Tabelas, Conectores, Automações,
                Equipe). Nenhum cargo dá acesso de administrador nem ao registro de atividades.
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
                        <button type="button" className="eve-btn eve-btn--danger" disabled={roleBusy} onClick={() => void deleteRole(role.id)}>
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
                    {ROLE_GRANTABLE_TABS.map((tab) => (
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

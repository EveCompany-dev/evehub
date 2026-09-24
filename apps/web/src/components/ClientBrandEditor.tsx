'use client';

import { useState, type JSX } from 'react';
import { pickProfile, PROFILE_FIELDS, type ClientProfile, type ProfileKey } from '../lib/client-profile-meta';
import { clientAccent, readableOn } from '../lib/table-tags';
import { ConfirmButton } from './ConfirmButton';
import type { AvailableConnector } from './DashboardShell';
import { ConnectorPicker } from './ClientConnectors';
import { EmojiPicker } from './EmojiPicker';
import { ImageDropZone } from './ImageDropZone';
import { useEscapeToClose } from './useEscapeToClose';
import { Smile } from '@eve/ui';

export interface BrandClient extends ClientProfile {
  id: string;
  name: string;
  notes: string | null;
  color: string | null;
  icon: string | null;
  logoUrl: string | null;
}

export interface ClientBrandEditorProps {
  /** Existing client to edit; omit to create one. */
  client?: BrandClient;
  onSaved: (client: BrandClient) => void;
  onDeleted?: (id: string) => void;
  onClose: () => void;
}

// White is here for logos designed for a light background (a transparent PNG in dark colors).
const PRESET_COLORS = ['#fa5300', '#e0553a', '#e8a33d', '#4f9d7f', '#2f7fd1', '#6a4fd1', '#c94f9b', '#1e1e1e', '#ffffff'];

/**
 * A client's identity card: name, brand color, logo, emoji and notes. These
 * are what relation cells in Tabelas, the gallery cards and the client page
 * paint themselves with, so filling them in once brands every place the
 * client shows up.
 */
export function ClientBrandEditor({ client, onSaved, onDeleted, onClose }: ClientBrandEditorProps): JSX.Element {
  const [name, setName] = useState(client?.name ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [color, setColor] = useState<string | null>(client?.color ?? null);
  const [icon, setIcon] = useState(client?.icon ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(client?.logoUrl ?? null);
  const [profile, setProfile] = useState<ClientProfile>(() => pickProfile(client ?? {}));
  const [showEmoji, setShowEmoji] = useState(false);
  // Right after a client is created: offer to connect its connectors before closing.
  const [connectStep, setConnectStep] = useState<{ client: BrandClient; available: AvailableConnector[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeToClose(onClose);

  const accent = clientAccent(name || 'Cliente', color);

  const save = async () => {
    if (!name.trim()) {
      setError('Dê um nome ao cliente.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), notes: notes.trim() || null, color, icon: icon.trim() || null, logoUrl, ...profile };
      const response = client
        ? await fetch(`/api/scheduling/clients/${client.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/scheduling/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // POST takes optional fields as absent, not null.
            body: JSON.stringify({
              name: payload.name,
              ...(payload.notes ? { notes: payload.notes } : {}),
              ...(color ? { color } : {}),
              ...(payload.icon ? { icon: payload.icon } : {}),
              ...(logoUrl ? { logoUrl } : {}),
              ...profile,
            }),
          });
      const body = (await response.json().catch(() => ({}))) as { client?: BrandClient; error?: string };
      if (!response.ok || !body.client) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      if (!client) {
        // First addition of a client: connectors are attached to a client that already
        // exists, so this comes after the save — skipped when there is nothing to offer.
        const offer = (await fetch('/api/instances', { cache: 'no-store' })
          .then((result) => (result.ok ? result.json() : null))
          .catch(() => null)) as { available?: AvailableConnector[] } | null;
        const options = (offer?.available ?? []).filter((connector) => connector.canCreate);
        if (options.length > 0) {
          setConnectStep({ client: body.client, available: options });
          return;
        }
      }
      onSaved(body.client);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!client || !onDeleted) return;
    setError(null);
    try {
      const response = await fetch(`/api/scheduling/clients/${client.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onDeleted(client.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  if (connectStep) {
    return (
      <ConnectorPicker
        clientId={connectStep.client.id}
        available={connectStep.available}
        intro={`“${connectStep.client.name}” foi criado. Quer conectar um conector agora? Você também pode fazer isso depois, na página do cliente.`}
        closeLabel="Agora não"
        onConnected={() => onSaved(connectStep.client)}
        onClose={() => onSaved(connectStep.client)}
      />
    );
  }

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal eve-brand" role="dialog" aria-label={client ? 'Editar cliente' : 'Novo cliente'} onClick={(event) => event.stopPropagation()}>
        <h2 className="eve-card__title">{client ? 'Editar cliente' : 'Novo cliente'}</h2>

        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        <div className="eve-brand__preview" style={{ background: accent, color: readableOn(accent) }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- just-uploaded brand logo
            <img src={logoUrl} alt="" />
          ) : (
            <span className="eve-brand__initial">{icon.trim() || (name.trim().charAt(0).toUpperCase() || '?')}</span>
          )}
          <span className="eve-brand__name">{name.trim() || 'Nome do cliente'}</span>
        </div>

        <label className="eve-field">
          <span className="eve-field__label">Nome</span>
          <input className="eve-input" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="eve-field">
          <span className="eve-field__label">Cor da marca</span>
          <div className="eve-brand__colors">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={color === preset ? 'eve-brand__swatch is-selected' : 'eve-brand__swatch'}
                style={{ background: preset }}
                aria-label={`Usar ${preset}`}
                onClick={() => setColor(preset)}
              />
            ))}
            <input type="color" aria-label="Escolher outra cor" value={color ?? '#fa5300'} onChange={(event) => setColor(event.target.value)} />
            {color && (
              <button type="button" className="eve-btn" onClick={() => setColor(null)}>
                Automática
              </button>
            )}
          </div>
        </div>

        <div className="eve-field">
          <span className="eve-field__label">Logo</span>
          <ImageDropZone
            value={logoUrl}
            onChange={setLogoUrl}
            endpoint="/api/uploads/client-logo"
            dropHint="Arraste o logo aqui ou clique para escolher"
            uploadingHint="Enviando…"
            removeLabel="Remover logo"
          />
        </div>

        <div className="eve-field">
          <span className="eve-field__label">Emoji (aparece antes do nome quando não há logo)</span>
          <span className="eve-brand__emoji">
            <input className="eve-input" maxLength={8} value={icon} onChange={(event) => setIcon(event.target.value)} placeholder="ex.: 🧵" />
            <button type="button" className="eve-btn" onClick={() => setShowEmoji((value) => !value)}>
              <Smile size={14} aria-hidden="true" />
            </button>
          </span>
          {showEmoji && (
            <EmojiPicker
              onSelect={(emoji) => {
                setIcon(emoji);
                setShowEmoji(false);
              }}
            />
          )}
        </div>

        {(['company', 'address'] as const).map((group) => (
          <fieldset key={group} className="eve-brand__group">
            <legend className="eve-field__label">{group === 'company' ? 'Dados cadastrais' : 'Endereço'}</legend>
            <div className="eve-brand__grid">
              {PROFILE_FIELDS.filter((field) => field.group === group).map((field) => (
                <label key={field.key} className={field.wide ? 'eve-brand__cell is-wide' : 'eve-brand__cell'}>
                  <span className="eve-brand__celllabel">{field.label}</span>
                  <input
                    className="eve-input"
                    type={field.input}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    value={profile[field.key] ?? ''}
                    onChange={(event) => setProfile((current) => ({ ...current, [field.key as ProfileKey]: event.target.value }))}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <label className="eve-field">
          <span className="eve-field__label">Notas</span>
          <textarea className="eve-input" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>

        <div className="eve-profile__actions">
          <button type="button" className="eve-btn eve-btn--primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="eve-btn" onClick={onClose}>
            Cancelar
          </button>
          {client && onDeleted && (
            <ConfirmButton
              confirmLabel="Apagar mesmo"
              // Names the blast radius: the projects go with the client, and
              // its jobs, posts, agenda events and financial entries lose the
              // link.
              question={`Apagar “${client.name}”? Os projetos dele são apagados junto.`}
              disabled={saving}
              onConfirm={() => void remove()}
            >
              Apagar cliente
            </ConfirmButton>
          )}
        </div>
      </div>
    </div>
  );
}

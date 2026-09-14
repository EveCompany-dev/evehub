'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { memberInitials, memberLabel, type JobMember } from './job-types';

export interface MemberSelectProps {
  members: JobMember[];
  value: string | null;
  placeholder: string;
  noneLabel?: string;
  onChange: (memberId: string | null) => void;
}

function Avatar({ member }: { member: JobMember }): JSX.Element {
  return (
    <span className="eve-avatar eve-avatar--fallback" style={{ width: 20, height: 20, fontSize: 9 }}>
      {memberInitials(member)}
    </span>
  );
}

/**
 * A native <select> can't render an avatar next to each option's name — this
 * is a small custom dropdown that can, used everywhere the board needs to
 * pick a person (task assignee, add-collaborator).
 */
export function MemberSelect({ members, value, placeholder, noneLabel, onChange }: MemberSelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = members.find((member) => member.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="eve-member-select" ref={ref}>
      <button type="button" className="eve-member-select__trigger" onClick={() => setOpen((value_) => !value_)}>
        {selected ? (
          <>
            <Avatar member={selected} />
            <span>{memberLabel(selected)}</span>
          </>
        ) : (
          <span className="eve-dim">{noneLabel ?? placeholder}</span>
        )}
      </button>

      {open && (
        <div className="eve-member-select__panel" role="listbox">
          {noneLabel && (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className="eve-member-select__option"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <span className="eve-dim">{noneLabel}</span>
            </button>
          )}
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={member.id === value}
              className="eve-member-select__option"
              onClick={() => {
                onChange(member.id);
                setOpen(false);
              }}
            >
              <Avatar member={member} />
              <span>{memberLabel(member)}</span>
            </button>
          ))}
          {members.length === 0 && !noneLabel && <p className="eve-dim eve-member-select__empty">{placeholder}</p>}
        </div>
      )}
    </div>
  );
}

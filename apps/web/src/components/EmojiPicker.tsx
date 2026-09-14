import type { JSX } from 'react';

// A fixed, curated set rather than a full Unicode picker library — "basic
// chat stuff" per the ask, not a Slack-grade emoji database.
const EMOJIS = [
  '😀', '😂', '😅', '😉', '😍', '🤔', '😎', '😢', '😭', '😡', '🥳', '😴',
  '👍', '👎', '👏', '🙏', '🤝', '💪', '🙌', '👀',
  '❤️', '🔥', '✅', '❌', '⚠️', '🎉', '🚀', '💡', '📌', '⏰',
  '☕', '🍕', '🎂', '🐛', '📎', '📅', '💬', '✍️',
];

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps): JSX.Element {
  return (
    <div className="eve-emoji-picker" role="menu">
      {EMOJIS.map((emoji) => (
        <button key={emoji} type="button" className="eve-emoji-picker__item" onClick={() => onSelect(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

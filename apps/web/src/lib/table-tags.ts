/**
 * Tag colors for select/multiselect columns (and status-style values).
 * A column stores an explicit color per option when one was chosen or
 * imported; everything else falls back to the semantic guess below and then
 * to a stable hash, so a value never changes color between renders.
 */
export const TAG_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_LABEL: Record<TagColor, string> = {
  gray: 'Cinza',
  brown: 'Marrom',
  orange: 'Laranja',
  yellow: 'Amarelo',
  green: 'Verde',
  blue: 'Azul',
  purple: 'Roxo',
  pink: 'Rosa',
  red: 'Vermelho',
};

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === 'string' && (TAG_COLORS as readonly string[]).includes(value);
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Ordered: the first rule that matches wins, so negations ("nao fazemos") sit above "ok"-style words. */
const SEMANTIC_RULES: { color: TagColor; pattern: RegExp }[] = [
  { color: 'red', pattern: /cancel|nao faz|nao vamos|erro|falh|atrasad|urgent|recusad|reprovad|bloquead|inativ|perdid/ },
  { color: 'green', pattern: /^ativ[ao]s?$|publicad|programad|conclu|aprovad|finalizad|feito|^ok$|criad|pront|entregue|pago|resolvid/ },
  { color: 'yellow', pattern: /ideia|pendent|aguard|rascunho|revis|analise|espera|^a ver$|a fazer|a definir|em breve/ },
  { color: 'blue', pattern: /andamento|producao|progresso|gravand|editand|agendad|em execucao|criando/ },
  // Content formats — the same palette the team already uses in Notion.
  { color: 'purple', pattern: /^reels?$/ },
  { color: 'pink', pattern: /^carrossel|^carousel/ },
  { color: 'orange', pattern: /^feed$/ },
  { color: 'blue', pattern: /^stories$|^story$/ },
  { color: 'gray', pattern: /^(-|nenhum|nenhuma|sem .*|n\/?a|arquivad[ao]|nao)$/ },
];

/** A color implied by what the word means ("Cancelado" is red), or null when it says nothing. */
export function guessTagColor(name: string): TagColor | null {
  const key = normalize(name);
  for (const rule of SEMANTIC_RULES) {
    if (rule.pattern.test(key)) return rule.color;
  }
  return null;
}

const HASH_PALETTE: TagColor[] = ['blue', 'purple', 'pink', 'orange', 'yellow', 'green', 'brown', 'red'];

export function hashTagColor(name: string): TagColor {
  let hash = 0;
  for (const char of normalize(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HASH_PALETTE[hash % HASH_PALETTE.length]!;
}

/** The color to paint an option: explicit choice, then meaning, then a stable hash. */
export function tagColorFor(name: string, explicit?: string): TagColor {
  if (isTagColor(explicit)) return explicit;
  return guessTagColor(name) ?? hashTagColor(name);
}

/**
 * A client's brand color for pills and cards: the one registered on the
 * client, else a stable hue derived from the name (so an unbranded client is
 * still recognizable at a glance and never changes color).
 */
export function clientAccent(label: string, color: string | null | undefined): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  let hash = 0;
  for (const char of normalize(label)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 46%)`;
}

/** Black or white, whichever reads on top of `color` (hex only — hsl accents always take white). */
export function readableOn(color: string): '#111111' | '#ffffff' {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color);
  if (!match) return '#ffffff';
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map((part) => parseInt(part, 16)) as [number, number, number];
  // Perceived luminance (Rec. 601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

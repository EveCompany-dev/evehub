/**
 * Portuguese without the diacritics, lowercased, so "agenda" matches "Agência"
 * and "conexao" matches "conexão". Every search box and matcher uses this one.
 */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

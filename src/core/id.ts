/** Converte um nome em id no padrão do Showdown ("Charizard-Mega-Y" -> "charizardmegay"). */
export function toId(text: unknown): string {
  if (typeof text !== 'string' && typeof text !== 'number') return '';
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

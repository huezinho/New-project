/**
 * Nomes de eventos e locais em português. Os nomes oficiais dos torneios vêm
 * em inglês nos dados ("2027 Recife Regional Championship" -> "Regional de Recife 2027").
 */

const COUNTRY_PT: Record<string, string> = {
  USA: 'EUA', Germany: 'Alemanha', France: 'França', Brazil: 'Brasil', Mexico: 'México', Poland: 'Polônia', Australia: 'Austrália',
  UK: 'Reino Unido', 'New Zealand': 'Nova Zelândia', Canada: 'Canadá', Czechia: 'Tchéquia', Netherlands: 'Países Baixos', Italy: 'Itália',
  Singapore: 'Singapura', Peru: 'Peru', Chile: 'Chile', Argentina: 'Argentina', Portugal: 'Portugal',
};

const REGION_PT: Record<string, string> = { 'Latin America': 'da América Latina', Europe: 'da Europa', 'North America': 'da América do Norte', Oceania: 'da Oceania' };

const CITY_PT: Record<string, string> = { Lisbon: 'Lisboa', Prague: 'Praga', Bologna: 'Bolonha', London: 'Londres', 'New Orleans': 'Nova Orleans' };
const ofCity = (city: string) => `${/^Rio de Janeiro$/.test(city) ? 'do' : 'de'} ${CITY_PT[city] ?? city}`;

const MONTH_PT: Record<string, string> = {
  Jan: 'jan', Feb: 'fev', Mar: 'mar', Apr: 'abr', May: 'mai', Jun: 'jun', Jul: 'jul', Aug: 'ago', Sep: 'set', Sept: 'set', Oct: 'out', Nov: 'nov', Dec: 'dez',
};

/** "2026 Indianapolis Regional Championships (first ...)" -> "Regional de Indianapolis 2026" (nomes oficiais vêm em inglês). */
export function eventNamePt(name: string | undefined): string {
  if (!name) return '—';
  let s = name.replace(/\s*\(online(?:, in-game(?: ladder)?)?\)/, ' (online)').trim();
  // parênteses com texto em inglês (palavras minúsculas) saem; siglas e listas de cidades ficam
  s = s.replace(/\s*\(([^)]*)\)/g, (all, inner: string) => (inner === 'online' || !/(^|[\s,])[a-z]/.test(inner) ? all : ''));
  let year = '';
  const y = /^(\d{4}) (.+)$/.exec(s);
  if (y) {
    year = ` ${y[1]}`;
    s = y[2];
  }
  let m = /^(.+?) Regional Championships?(.*)$/.exec(s);
  if (m) return `Regional ${ofCity(m[1])}${year}${m[2]}`;
  m = /^(.+?) International Championships?(.*)$/.exec(s);
  if (m) return `Internacional ${REGION_PT[m[1]] ?? `de ${m[1]}`}${year}${m[2]}`;
  m = /^(?:Pokémon )?World Championships?(.*)$/.exec(s);
  if (m) return `Mundial Pokémon${year}${m[1]}`;
  m = /^(.+?) Special Championships?(.*)$/.exec(s);
  if (m) return `Special Championship ${ofCity(m[1])}${year}${m[2]}`;
  m = /^(.+?) Special Event(.*)$/.exec(s);
  if (m) return `Evento especial ${ofCity(m[1])}${year}${m[2]}`;
  m = /^Global Challenge (\w+)(.*)$/.exec(s);
  if (m) return `Global Challenge ${m[1]}${year}${m[2]}`;
  s = s.replace(/^Regionals\b/, 'Regionais').replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/g, mo => MONTH_PT[mo] ?? mo).replace(/(\w)-(\w)/g, '$1–$2');
  return `${s}${year}`;
}

export function locationPt(loc: string | undefined): string {
  if (!loc) return '—';
  if (/^online/i.test(loc)) return 'Online (no jogo)';
  return loc
    .replace(/^([^,(]+)/, (city: string) => CITY_PT[city.trim()] ?? city)
    .replace(/, ([A-Za-z ]+)$/, (_, c: string) => `, ${COUNTRY_PT[c] ?? c}`);
}

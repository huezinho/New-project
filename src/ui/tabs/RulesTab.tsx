/** Aba "Regras e atualizações": regulação, calendário, regras do Champions, patches e mudanças automáticas. */
import { useMemo, useState, type ReactNode } from 'react';
import type { DataChange } from '../../core/types.ts';
import { Card, Notice, ScoreBar } from '../components/common.tsx';
import type { ItemAvailability, PatchChange, PatchVersion, RegulationInfo, SeasonEvent } from '../data.ts';
import { useApp } from '../state.tsx';
import { eventNamePt, locationPt } from '../eventNames.ts';
import { formatDate, formatLooseDate, looseDateRange, matchesQuery } from '../util.ts';

const DIRECTIONS = ['buff', 'nerf', 'change'] as const;
const DIRECTION_PT: Record<string, string> = { buff: 'Buffs', nerf: 'Nerfs', change: 'Mudanças' };
const DIRECTION_ONE: Record<string, string> = { buff: 'buff', nerf: 'nerf', change: 'mudança' };
const KIND_PT: Record<string, string> = {
  move: 'Golpe', ability: 'Habilidade', item: 'Item', species: 'Espécie', mechanic: 'Mecânica', learnset: 'Learnset',
  'added-move': 'Golpe novo', 'removed-move': 'Golpe removido', 'added-item': 'Item novo', 'removed-item': 'Item removido',
};

/** Itens notáveis de Scarlet/Violet (reserva quando regulations.json não existe). */
const NOTABLE_ITEMS: Record<string, string> = {
  choicescarf: 'Choice Scarf', lifeorb: 'Life Orb', focussash: 'Focus Sash', sitrusberry: 'Sitrus Berry', lumberry: 'Lum Berry',
  rockyhelmet: 'Rocky Helmet', leftovers: 'Leftovers', lightclay: 'Light Clay', mentalherb: 'Mental Herb', whiteherb: 'White Herb',
  wiseglasses: 'Wise Glasses', muscleband: 'Muscle Band', expertbelt: 'Expert Belt', choiceband: 'Choice Band', choicespecs: 'Choice Specs',
  assaultvest: 'Assault Vest', boosterenergy: 'Booster Energy', covertcloak: 'Covert Cloak', safetygoggles: 'Safety Goggles',
  clearamulet: 'Clear Amulet', loadeddice: 'Loaded Dice', mirrorherb: 'Mirror Herb', throatspray: 'Throat Spray',
  weaknesspolicy: 'Weakness Policy', ejectpack: 'Eject Pack', ejectbutton: 'Eject Button',
};

/** Descrição em português das cláusulas conhecidas (regulations.json traz o texto da pesquisa em inglês). */
const CLAUSE_PT: [RegExp, string, string][] = [
  [/species clause/i, 'Species Clause', 'Sem dois Pokémon com o mesmo número da Pokédex (formas contam como a mesma espécie: Rotom-Heat + Rotom-Wash é ilegal).'],
  [/item clause/i, 'Item Clause', 'Dois Pokémon não podem segurar o mesmo item.'],
  [/restricted|mythical/i, 'Sem Lendários restritos e Míticos', 'Proibidos pelas Flat Rules (e nenhum está no elenco do Champions).'],
  [/level 50/i, 'Nível 50', 'Todos os Pokémon são ajustados para o nível 50.'],
  [/mega/i, 'Mega Evolução', 'Só uma Mega Evolução por batalha; a Mega conta como a espécie base na Species Clause.'],
  [/nickname/i, 'Nickname Clause', 'Só no Showdown: apelidos não podem se repetir.'],
  [/banlist/i, 'Sem banlist extra', 'O VGC usa só as Flat Rules; banimentos de OU/UU do Showdown valem apenas para singles.'],
];

function regulationLabel(reg: string | undefined): string {
  if (!reg) return '—';
  if (/^M-[A-Z]$/.test(reg)) return `Reg ${reg}`;
  if (/next regulation|post-M/i.test(reg)) return 'próxima (a anunciar)';
  if (/unknown/i.test(reg)) return 'a definir';
  return reg;
}

const regCode = (text: string | undefined) => /\bM-[A-Z]\b/.exec(text ?? '')?.[0];

function semver(v: string | undefined): number[] {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : [-1, -1, -1];
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  if (!/^https?:\/\//.test(href)) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/** Lista de fontes: links viram "domínio ↗", textos ficam como estão. */
function SourceList({ sources, max = 8 }: { sources: unknown[] | undefined; max?: number }) {
  const list = (sources ?? []).filter((s): s is string | { label?: string; url?: string } => typeof s === 'string' || (!!s && typeof s === 'object'));
  if (!list.length) return null;
  return (
    <p className="small sources-line">
      Fontes:{' '}
      {list.slice(0, max).map((s, i) => {
        const raw = typeof s === 'string' ? s : s.url ?? s.label ?? '';
        const url = /https?:\/\/\S+/.exec(raw)?.[0];
        const label = typeof s === 'object' && s.label ? s.label : url ? hostOf(url) : raw.slice(0, 60);
        return (
          <span key={i}>
            {i > 0 && ' · '}
            {url ? <ExtLink href={url}>{label} ↗</ExtLink> : <span className="muted">{label}</span>}
          </span>
        );
      })}
      {list.length > max && <span className="muted"> · +{list.length - max}</span>}
    </p>
  );
}

export function RulesTab() {
  return (
    <div className="rules">
      <RegulationCard />
      <Calendar />
      <BattleRules />
      <Patches />
      <AutoChanges />
    </div>
  );
}

/* ----------------------------- regulação ----------------------------- */

const DAY = 86_400_000;

function RegulationCard() {
  const { data, regulation } = useApp();
  const format = data.dex.formats.find(f => f.regulation === regulation);
  const regs = data.regulations;
  const current = regs?.currentRegulation ?? data.dex.currentRegulation;
  const isCurrent = format?.current ?? regulation === current;
  const info = regs?.regulations.find(r => r.id === regulation);
  const win = regulation === current && regs?.currentRegulationWindow ? regs.currentRegulationWindow : null;
  const start = win?.start ? new Date(win.start).getTime() : info?.start ? Date.parse(info.start) : NaN;
  const end = win?.end ? new Date(win.end).getTime() : info?.end ? Date.parse(info.end) : NaN;
  const now = Date.now();
  const hasWindow = Number.isFinite(start) && Number.isFinite(end) && end > start;
  const daysLeft = hasWindow ? Math.ceil((end - now) / DAY) : null;
  const next = regs?.nextRegulation;
  const nextStart = next?.expectedStart ? /\d{4}-\d{2}-\d{2}/.exec(next.expectedStart)?.[0] : undefined;
  const gameVersion = data.patches?.meta?.currentGameVersion ?? regs?.gameVersion;
  const timeline = useMemo(() => [...(regs?.regulations ?? [])].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? '')), [regs]);

  return (
    <Card title="Regulação">
      <div className="reg-summary">
        <span className={`badge badge-reg${isCurrent ? '' : ' old'}`}>Reg {regulation}</span>
        <div>
          <strong>{format?.name ?? `Regulação ${regulation}`}</strong>
          <p className="small muted">
            {isCurrent ? 'Regulação atual do circuito oficial.' : 'Regulação anterior (só para consulta e comparação).'}
            {format?.season ? ` Temporada ${format.season}.` : ''}
            {gameVersion ? ` Versão do jogo: ${gameVersion}.` : ''}
          </p>
          {format && format.ruleset.length > 0 && (
            <p className="chips">
              {format.ruleset.map(r => (
                <span key={r} className="tag">
                  {r}
                </span>
              ))}
            </p>
          )}
          {format && format.banlist.length > 0 && <p className="small">Banidos: {format.banlist.join(', ')}</p>}
        </div>
      </div>

      {hasWindow && (
        <div className="reg-window">
          <div className="row-between">
            <span>
              Vigência: <strong>{formatDate(new Date(start).toISOString())}</strong> a <strong>{formatDate(new Date(end).toISOString())}</strong>
            </span>
            {daysLeft !== null && (
              <span className={`small ${daysLeft <= 14 && daysLeft > 0 ? 'bad-text' : 'muted'}`}>
                {daysLeft > 1 ? `faltam ${daysLeft} dias` : daysLeft === 1 ? 'último dia' : 'encerrada'}
              </span>
            )}
          </div>
          <ScoreBar value={(now - start) / (end - start)} tone="good" label="Tempo decorrido da regulação" />
        </div>
      )}
      {isCurrent && next && (
        <p className="small">
          <strong>Próxima regulação:</strong>{' '}
          {next.announced && next.id
            ? `Reg ${next.id}${nextStart ? ` a partir de ${formatLooseDate(nextStart)}` : ''}.`
            : `ainda não anunciada${nextStart ? ` (a atual termina em ${formatLooseDate(nextStart)})` : ''}.`}
        </p>
      )}

      {data.dex.formats.length > 1 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Formato no Showdown</th>
                <th scope="col">Regulação</th>
                <th scope="col">Situação</th>
              </tr>
            </thead>
            <tbody>
              {data.dex.formats.map(f => (
                <tr key={f.id} className={f.regulation === regulation ? 'row-on' : ''}>
                  <td>{f.name}</td>
                  <td>Reg {f.regulation}</td>
                  <td>{f.current ? <span className="ok-text">atual</span> : <span className="muted">anterior</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {timeline.length > 0 && (
        <>
          <h3>Linha do tempo das regulações</h3>
          <ol className="timeline">
            {timeline.map((r, i) => (
              <RegulationItem key={r.id ?? i} r={r} current={r.id === current} />
            ))}
          </ol>
        </>
      )}
      {!regs && <p className="small muted">O calendário detalhado aparece aqui quando o arquivo regulations.json estiver disponível.</p>}
    </Card>
  );
}

function RegulationItem({ r, current }: { r: RegulationInfo; current: boolean }) {
  const { data } = useApp();
  const diff = data.regulations?.legalityDiffs.find(d => d.to === r.id)?.diff;
  const added = diff?.added ?? [];
  const megas = new Set(diff?.addedMegas ?? added.filter(n => /-Mega/.test(n)));
  const prev = data.regulations?.legalityDiffs.find(d => d.to === r.id)?.from;
  return (
    <li className={current ? 'on' : ''}>
      <div className="row-between">
        <strong>
          Reg {r.id ?? r.name}
          {current && <span className="tag tag-ok">atual</span>}
        </strong>
        <span className="small muted">
          {formatLooseDate(r.start)} – {r.end ? formatLooseDate(r.end) : 'atual'}
        </span>
      </div>
      {r.rankedSeasons && r.rankedSeasons.length > 0 && (
        <p className="chips small">
          {r.rankedSeasons.map((s, i) => (
            <span key={s.season ?? i} className="tag" title={[s.start, s.end].filter(Boolean).join(' → ')}>
              Temporada {s.season}
              {s.start ? `: ${formatLooseDate(/\d{4}-\d{2}-\d{2}/.exec(s.start)?.[0] ?? s.start)}` : ''}
            </span>
          ))}
        </p>
      )}
      {added.length > 0 && (
        <details className="small">
          <summary>
            +{added.length} Pokémon/formas em relação à Reg {prev}
            {megas.size ? ` (${megas.size} Megas novas)` : ''}
            {diff?.removed?.length ? ` · −${diff.removed.length} removidos` : ''}
          </summary>
          <p className="chips">
            {added.map(n => (
              <span key={n} className={`tag${megas.has(n) ? ' tag-mega' : ''}`}>
                {n}
              </span>
            ))}
          </p>
        </details>
      )}
      {r.events && r.events.length > 0 && (
        <ul className="small reg-events">
          {r.events.map((e, i) => (
            <li key={i}>
              <span className="muted">{formatLooseDate(e.date?.split(/ \(| or /)[0])}</span> · {eventNamePt(e.event)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/* ----------------------------- calendário ---------------------------- */

function eventStatus(e: SeasonEvent, now: number): 'past' | 'live' | 'upcoming' {
  const range = looseDateRange(e.date);
  if (range) {
    if (range.end + DAY < now) return 'past';
    if (range.start <= now) return 'live';
    return 'upcoming';
  }
  return e.status === 'past' ? 'past' : 'upcoming';
}

const STATUS_PT = { past: 'encerrado', live: 'acontecendo', upcoming: 'próximo' } as const;

function Calendar() {
  const { data } = useApp();
  const events = data.regulations?.season2027 ?? [];
  const [showPast, setShowPast] = useState(false);
  const [onlyBR, setOnlyBR] = useState(false);
  const now = Date.now();
  if (!events.length) return null;
  // ordem cronológica (o JSON curado pode vir fora de ordem); sem data vai para o fim
  const rows = events
    .map(e => ({ e, status: eventStatus(e, now), br: /brazil|brasil/i.test(e.location ?? ''), start: looseDateRange(e.date)?.start ?? Infinity }))
    .sort((a, b) => (a.start === b.start ? 0 : a.start - b.start));
  const nextIdx = rows.findIndex(r => r.status !== 'past');
  const visible = rows.filter(r => (showPast || r.status !== 'past') && (!onlyBR || r.br));
  const pastCount = rows.filter(r => r.status === 'past').length;
  return (
    <Card
      title="Calendário da temporada 2027"
      actions={<span className="muted small">{events.length} eventos · confira as datas no site oficial</span>}
    >
      <div className="filters filters-inline">
        <label className="check">
          <input type="checkbox" checked={showPast} onChange={e => setShowPast(e.target.checked)} /> Mostrar encerrados ({pastCount})
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyBR} onChange={e => setOnlyBR(e.target.checked)} /> Só eventos no Brasil
        </label>
      </div>
      <div className="table-wrap">
        <table className="data-table calendar stack">
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Evento</th>
              <th scope="col">Local</th>
              <th scope="col">Regulação</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ e, status, br }) => {
              const isNext = rows[nextIdx]?.e === e;
              return (
                <tr key={`${e.event}-${e.date}`} className={`${status}${isNext ? ' row-on' : ''}`}>
                  <td className="nowrap stack-sub" title={e.date}>
                    {formatLooseDate(e.date?.split(/ \(| or /)[0])}
                  </td>
                  <td className="stack-title">
                    <strong>{eventNamePt(e.event)}</strong>
                    {isNext && <span className="tag tag-mine">próximo evento</span>}
                  </td>
                  <td data-label="Local">
                    {locationPt(e.location)}
                    {br && <span className="tag tag-ok">Brasil</span>}
                  </td>
                  <td className="nowrap" data-label="Regulação">
                    {regulationLabel(e.regulation)}
                  </td>
                  <td data-label="Situação">
                    <span className={`status status-${status}`}>{STATUS_PT[status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="muted small">Nenhum evento com esses filtros.</p>}
    </Card>
  );
}

/* ------------------------------- regras ------------------------------ */

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function BattleRules() {
  const { data, regulation } = useApp();
  const { statPoints } = data.dex;
  const br = data.regulations?.battleRules ?? null;
  const timer = br && typeof br.timer === 'object' && br.timer ? ((br.timer as Record<string, unknown>).inGameAndVGC as Record<string, unknown> | undefined) : undefined;
  const total = num(timer?.totalGameTimeMin);
  const yours = num(timer?.yourTimeMin);
  const move = num(timer?.moveTimeSec);
  const preview = num(timer?.teamPreviewSec);
  const ppFormula = data.patches?.meta?.ppFormula;
  const clauses = Array.isArray(br?.clauses) ? (br!.clauses as { clause?: string; source?: string }[]) : [];

  const rules: [string, ReactNode][] = [
    ['Nível', `${statPoints?.level ?? 50} — todos os Pokémon são ajustados; IVs fixos no máximo (31).`],
    ['Stat Points', `${statPoints?.total ?? 66} SP no total, no máximo ${statPoints?.maxPerStat ?? 32} por atributo; cada SP vale +1 no atributo (antes da natureza).`],
    ['Naturezas', '+10% em um atributo e −10% em outro (há neutras); podem ser trocadas no Treino do jogo.'],
    ['PP', ppFormula ?? 'PP base limitado a 20; no jogo o máximo é (PP base ÷ 5 + 1) × 4.'],
    ['Terastal', 'Não existe no Champions (nem Dynamax ou Z-Moves).'],
    ['Mega Evolução', 'Só 1 Mega Evolução por batalha. Pode levar várias Mega Stones, mas mais de 2 costuma ser desperdício.'],
    ['Formato', 'Duplas: leva 6, escolhe 4 no preview.'],
    ['Cláusulas', 'Item Clause (sem itens repetidos) e Species Clause (sem espécies repetidas).'],
    ['Open Team Sheets', 'Espécies, itens, habilidades e golpes são visíveis ao oponente (SP e natureza não).'],
    ['Melhor de 3', 'Eventos presenciais (Regionais, Internacionais, Mundial) são em melhor de 3; Global Challenges online são partidas únicas.'],
    ['Paralisia', 'Chance de 1/8 (12,5%) de não agir no turno; reduz a Velocidade pela metade.'],
    ['Sono e congelamento', 'Sono dura 2–3 turnos; congelamento dura no máximo 3 turnos.'],
  ];
  if (total || yours || move || preview) {
    rules.splice(8, 0, [
      'Tempo',
      [
        total && `${total} min de partida`,
        yours && `${yours} min de “seu tempo”`,
        move && `${move} s por turno`,
        preview && `${preview} s para escolher a equipe`,
      ]
        .filter(Boolean)
        .join(' · ') + '.',
    ]);
  }
  return (
    <Card title="Regras de batalha do Pokémon Champions">
      <dl className="rules-list">
        {rules.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {clauses.length > 0 && (
        <>
          <h3>Cláusulas da Reg {regulation}</h3>
          <ul className="clauses">
            {clauses.map((c, i) => {
              const hit = CLAUSE_PT.find(([re]) => re.test(c.clause ?? ''));
              return (
                <li key={i}>
                  <strong>{hit?.[1] ?? c.clause}</strong>
                  {hit && <span className="small"> — {hit[2]}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {br && Array.isArray(br.sources) && <SourceList sources={br.sources as unknown[]} />}
      <ItemsAvailability />
    </Card>
  );
}

const AVAIL_KEY: Record<string, keyof ItemAvailability> = { 'M-C': 'available', 'M-B': 'availableMB', 'M-A': 'availableMA' };
const PREV_KEY: Record<string, keyof ItemAvailability | undefined> = { 'M-C': 'availableMB', 'M-B': 'availableMA', 'M-A': undefined };

function ItemsAvailability() {
  const { data, regulation } = useApp();
  const [query, setQuery] = useState('');
  const list = data.regulations?.itemsAvailability ?? [];
  const key = AVAIL_KEY[regulation];
  // com o JSON curado: disponibilidade por regulação; sem ele, lista fixa checada no dex
  const rows = useMemo(() => {
    if (list.length && key) {
      const prev = PREV_KEY[regulation];
      return list.map(i => ({ name: i.item, ok: !!i[key], isNew: !!i[key] && !!prev && !i[prev] }));
    }
    return Object.entries(NOTABLE_ITEMS).map(([id, name]) => ({ name, ok: !!data.dex.items[id]?.legal?.[regulation], isNew: false }));
  }, [list, key, regulation, data.dex.items]);
  const filtered = rows.filter(r => matchesQuery(query, r.name)).sort((a, b) => a.name.localeCompare(b.name));
  const available = filtered.filter(r => r.ok);
  const missing = filtered.filter(r => !r.ok);
  const fresh = filtered.filter(r => r.isNew);
  const legalCount = Object.values(data.dex.items).filter(i => i.legal?.[regulation]).length;
  return (
    <>
      <h3>Itens na Reg {regulation}</h3>
      <p className="small muted">
        {legalCount} itens seguráveis disponíveis no total. Abaixo, os itens competitivos de Scarlet/Violet e se existem no Champions.
      </p>
      {rows.length > 12 && (
        <div className="filters">
          <label className="field">
            <span className="field-label">Buscar item</span>
            <input className="input" type="search" value={query} placeholder="Ex.: Choice, Berry, Herb…" onChange={e => setQuery(e.target.value)} />
          </label>
        </div>
      )}
      {fresh.length > 0 && (
        <>
          <p className="small ok-text">Novos nesta regulação ({fresh.length})</p>
          <p className="chips">
            {fresh.map(i => (
              <span key={i.name} className="tag tag-mine">
                {i.name}
              </span>
            ))}
          </p>
        </>
      )}
      <div className="two-col tight">
        <div>
          <p className="small ok-text">Disponíveis ({available.length})</p>
          <p className="chips">
            {available.map(i => (
              <span key={i.name} className="tag tag-ok">
                {i.name}
              </span>
            ))}
          </p>
        </div>
        <div>
          <p className="small bad-text">Ausentes ({missing.length})</p>
          <p className="chips">
            {missing.map(i => (
              <span key={i.name} className="tag tag-bad">
                {i.name}
              </span>
            ))}
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------- patches ----------------------------- */

const fmtVal = (v: unknown) => (v === true ? 'nunca erra' : v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function changeText(c: PatchChange | DataChange): string {
  if (c.notePt) return c.notePt;
  if (c.field) return `${c.field}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`;
  return '';
}

function ChangeLine({ c }: { c: PatchChange | DataChange }) {
  const dir = c.direction ?? 'change';
  return (
    <li className={`change change-${dir}`}>
      <span className={`dir dir-${dir}`}>{DIRECTION_ONE[dir] ?? dir}</span>
      {c.kind && <span className="tag">{KIND_PT[c.kind] ?? c.kind}</span>}
      <strong>{c.name}</strong>
      <span className="small">{changeText(c)}</span>
    </li>
  );
}

/** Junta mudanças com o mesmo texto (ex.: 30 Pokémon "adicionados no M-B") numa linha só. */
function mergeChanges(list: PatchChange[]): { key: string; c: PatchChange; names: string[] }[] {
  const out = new Map<string, { key: string; c: PatchChange; names: string[] }>();
  list.forEach((c, i) => {
    const text = changeText(c);
    const key = text && list.filter(o => changeText(o) === text && o.kind === c.kind).length > 2 ? `${c.kind}|${text}` : `#${i}`;
    const g = out.get(key);
    if (g) g.names.push(c.name ?? '?');
    else out.set(key, { key, c, names: [c.name ?? '?'] });
  });
  return [...out.values()];
}

function Patches() {
  const { data } = useApp();
  const patches = data.patches;
  const versions = useMemo(
    () =>
      [...(patches?.versions ?? [])].sort((a, b) => {
        const va = semver(a.version);
        const vb = semver(b.version);
        for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
        return (b.date ?? '').localeCompare(a.date ?? '');
      }),
    [patches],
  );
  return (
    <Card
      title="Histórico de patches (buffs e nerfs)"
      actions={
        patches?.meta?.currentGameVersion ? <span className="muted small">versão atual do jogo: {patches.meta.currentGameVersion}</span> : null
      }
    >
      {!patches ? (
        <Notice kind="info">O histórico curado de patches (patches.json) ainda não está disponível. As mudanças automáticas abaixo vêm do dex.</Notice>
      ) : versions.length === 0 ? (
        <p className="muted">Nenhuma versão registrada.</p>
      ) : (
        <ol className="patches">
          {versions.map((v, i) => (
            <PatchItem key={`${v.version}-${i}`} v={v} open={i === 0} />
          ))}
        </ol>
      )}
      {patches && patches.championsVsSV.length > 0 && <CuratedVsSV list={patches.championsVsSV} />}
      {patches && patches.unavailableButDataChanged.length > 0 && (
        <details className="vs">
          <summary>Alterados nos dados, mas indisponíveis na regulação ({patches.unavailableButDataChanged.length})</summary>
          <p className="small muted">O jogo já tem estes ajustes prontos para golpes/itens que ainda não podem ser usados.</p>
          <ul className="changes">
            {patches.unavailableButDataChanged.map((c, i) => (
              <ChangeLine key={i} c={c} />
            ))}
          </ul>
        </details>
      )}
      {patches && patches.simulatorFixes.length > 0 && (
        <details className="vs">
          <summary>Correções no simulador do Showdown ({patches.simulatorFixes.length})</summary>
          <ul className="changes">
            {patches.simulatorFixes.map((f, i) => (
              <li key={i} className="change">
                <span className="small muted nowrap">{formatLooseDate(f.date)}</span>
                {f.commit && (
                  <code>
                    {f.source ? <ExtLink href={f.source}>{f.commit}</ExtLink> : f.commit}
                  </code>
                )}
                <span className="small">{f.notePt}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {patches && patches.gaps.length > 0 && (
        <details className="vs">
          <summary>Lacunas conhecidas da pesquisa ({patches.gaps.length})</summary>
          <ul className="notes small">
            {patches.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function PatchItem({ v, open }: { v: PatchVersion; open: boolean }) {
  const changes = v.changes ?? [];
  const groups = DIRECTIONS.map(d => ({ d, list: changes.filter(c => (c.direction ?? 'change') === d) }));
  const other = changes.filter(c => !(DIRECTIONS as readonly string[]).includes(c.direction ?? 'change'));
  const notes = Array.isArray(v.notesPt) ? v.notesPt : v.notesPt ? [v.notesPt] : [];
  const version = /^[\d.]+/.exec(v.version ?? '')?.[0] ?? v.version ?? '?';
  const versionNote = v.version && version !== v.version ? v.version.slice(version.length).trim().replace(/^\((.*)\)$/, '$1') : '';
  const code = regCode(v.regulation);
  return (
    <li className="patch">
      <details open={open}>
        <summary>
          <strong>Versão {version}</strong>
          <span className="small muted">{formatLooseDate(v.date)}</span>
          {code && <span className="tag">Reg {code}</span>}
          <span className="patch-counts small">
            {groups.map(g =>
              g.list.length ? (
                <span key={g.d} className={`dir dir-${g.d}`}>
                  {g.list.length} {DIRECTION_ONE[g.d]}
                  {g.list.length > 1 ? 's' : ''}
                </span>
              ) : null,
            )}
            {!changes.length && <span className="muted">sem mudanças de balanceamento registradas</span>}
          </span>
        </summary>
        {versionNote && <p className="small muted">{versionNote}</p>}
        {v.regulation && v.regulation !== code && <p className="small muted">Regulação: {formatLooseDate(v.regulation)}</p>}
        {notes.map((n, i) => (
          <p key={i} className="small">
            {n}
          </p>
        ))}
        {groups
          .filter(g => g.list.length)
          .map(g => (
            <div key={g.d}>
              <h4>{DIRECTION_PT[g.d]}</h4>
              <ul className="changes">
                {mergeChanges(g.list).map(({ key, c, names }) =>
                  names.length > 1 ? (
                    <li key={key} className={`change change-${g.d}`}>
                      <span className={`dir dir-${g.d}`}>{DIRECTION_ONE[g.d]}</span>
                      {c.kind && <span className="tag">{KIND_PT[c.kind] ?? c.kind}</span>}
                      <span className="small">
                        <strong>{changeText(c)}</strong> ({names.length}): {names.join(', ')}
                      </span>
                    </li>
                  ) : (
                    <ChangeLine key={key} c={c} />
                  ),
                )}
              </ul>
            </div>
          ))}
        {other.length > 0 && (
          <ul className="changes">
            {other.map((c, i) => (
              <ChangeLine key={i} c={c} />
            ))}
          </ul>
        )}
        <SourceList sources={v.sources} />
      </details>
    </li>
  );
}

function isChange(v: unknown): v is PatchChange {
  return !!v && typeof v === 'object' && ('notePt' in v || 'name' in v);
}

function CuratedVsSV({ list }: { list: unknown[] }) {
  const [query, setQuery] = useState('');
  const [dir, setDir] = useState('');
  const changes = list.filter(isChange);
  const filtered = changes.filter(c => (!dir || (c.direction ?? 'change') === dir) && matchesQuery(query, c.name, c.notePt, c.field, KIND_PT[c.kind ?? '']));
  return (
    <details className="vs">
      <summary>
        Champions × Scarlet/Violet: {changes.length} diferenças curadas
        <span className="patch-counts small">
          {DIRECTIONS.map(d => {
            const n = changes.filter(c => (c.direction ?? 'change') === d).length;
            return n ? (
              <span key={d} className={`dir dir-${d}`}>
                {n} {DIRECTION_ONE[d]}
                {n > 1 ? 's' : ''}
              </span>
            ) : null;
          })}
        </span>
      </summary>
      <div className="filters">
        <label className="field">
          <span className="field-label">Buscar</span>
          <input className="input" type="search" value={query} placeholder="Ex.: Fake Out, Intimidate, PP…" onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Tipo de mudança</span>
          <select className="input" value={dir} onChange={e => setDir(e.target.value)}>
            <option value="">Todas</option>
            {DIRECTIONS.map(d => (
              <option key={d} value={d}>
                {DIRECTION_PT[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="changes">
        {filtered.map((c, i) => (
          <ChangeLine key={`${c.id ?? c.name}-${c.field}-${i}`} c={c} />
        ))}
      </ul>
      {filtered.length === 0 && <p className="muted small">Nada encontrado.</p>}
    </details>
  );
}

function AutoChanges() {
  const { data } = useApp();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({});
  const all = data.dex.changes;
  const kinds = [...new Set(all.map(c => c.kind))];
  const filtered = useMemo(
    () => all.filter(c => (!kind || c.kind === kind) && matchesQuery(query, c.name, c.notePt, c.field, KIND_PT[c.kind])),
    [all, kind, query],
  );
  return (
    <Card title="Mudanças automáticas: Champions × Scarlet/Violet" actions={<span className="muted small">{all.length} diferenças detectadas no dex</span>}>
      <p className="small muted">
        Comparação automática entre os dados do Champions e de Scarlet/Violet feita pelo atualizador: poder, precisão, PP, efeitos e
        disponibilidade de golpes, habilidades e itens.
      </p>
      <div className="filters">
        <label className="field">
          <span className="field-label">Buscar mudança</span>
          <input className="input" type="search" value={query} placeholder="Ex.: Fake Out, PP, Choice…" onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Categoria</span>
          <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">Todas</option>
            {kinds.map(k => (
              <option key={k} value={k}>
                {KIND_PT[k] ?? k}
              </option>
            ))}
          </select>
        </label>
      </div>
      {DIRECTIONS.map(d => {
        const list = filtered.filter(c => c.direction === d);
        const limit = limits[d] ?? 60;
        return (
          <details key={d} className="change-group" open={!!query}>
            <summary>
              <span className={`dir dir-${d}`}>{DIRECTION_PT[d]}</span> <span className="muted small">{list.length}</span>
            </summary>
            {list.length === 0 ? (
              <p className="muted small">Nada encontrado.</p>
            ) : (
              <ul className="changes">
                {list.slice(0, limit).map((c, i) => (
                  <ChangeLine key={`${c.id}-${c.field}-${i}`} c={c} />
                ))}
              </ul>
            )}
            {list.length > limit && (
              <button type="button" className="btn btn-sm" onClick={() => setLimits(l => ({ ...l, [d]: list.length }))}>
                Mostrar todas ({list.length})
              </button>
            )}
          </details>
        );
      })}
    </Card>
  );
}

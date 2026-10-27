/** Aba "Regras e atualizações": regulação, calendário, regras do Champions, patches e mudanças automáticas. */
import { useMemo, useState, type ReactNode } from 'react';
import type { DataChange } from '../../core/types.ts';
import { Card, Notice } from '../components/common.tsx';
import type { PatchChange, PatchVersion } from '../data.ts';
import { useApp } from '../state.tsx';
import { formatDate, matchesQuery } from '../util.ts';

const DIRECTION_PT: Record<string, string> = { buff: 'Buffs', nerf: 'Nerfs', change: 'Mudanças' };
const DIRECTION_ONE: Record<string, string> = { buff: 'buff', nerf: 'nerf', change: 'mudança' };
const KIND_PT: Record<string, string> = { move: 'Golpe', ability: 'Habilidade', item: 'Item', species: 'Espécie' };

/** Itens notáveis de Scarlet/Violet para mostrar o que existe ou não no Champions. */
const NOTABLE_ITEMS = [
  'choicescarf', 'lifeorb', 'focussash', 'sitrusberry', 'lumberry', 'rockyhelmet', 'leftovers', 'lightclay', 'mentalherb', 'whiteherb',
  'wiseglasses', 'muscleband', 'expertbelt', 'choiceband', 'choicespecs', 'assaultvest', 'boosterenergy', 'covertcloak',
  'safetygoggles', 'clearamulet', 'loadeddice', 'mirrorherb', 'throatspray', 'weaknesspolicy', 'ejectpack', 'ejectbutton',
];

export function RulesTab() {
  return (
    <div className="rules">
      <RegulationCard />
      <BattleRules />
      <Patches />
      <AutoChanges />
    </div>
  );
}

function RegulationCard() {
  const { data, regulation } = useApp();
  const format = data.dex.formats.find(f => f.regulation === regulation);
  const regs = data.regulations;
  const current = regs?.currentRegulation ?? data.dex.currentRegulation;
  return (
    <Card title="Regulação">
      <div className="reg-summary">
        <span className="badge badge-reg">Reg {regulation}</span>
        <div>
          <strong>{format?.name ?? `Regulação ${regulation}`}</strong>
          <p className="small muted">
            {format?.current || regulation === current ? 'Regulação atual do circuito oficial.' : 'Regulação anterior (só para consulta e comparação).'}
            {format?.season ? ` Temporada ${format.season}.` : ''}
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
      {data.dex.formats.length > 1 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Formato</th>
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
      {regs && regs.regulations.length > 0 && (
        <>
          <h3>Linha do tempo das regulações</h3>
          <ol className="timeline">
            {regs.regulations.map((r, i) => (
              <li key={r.id ?? i} className={r.id === current ? 'on' : ''}>
                <div className="row-between">
                  <strong>{r.name ?? `Reg ${r.id}`}</strong>
                  <span className="small muted">
                    {formatDate(r.start)} – {r.end ? formatDate(r.end) : 'atual'}
                  </span>
                </div>
                {r.notes && <p className="small">{Array.isArray(r.notes) ? r.notes.join(' ') : r.notes}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      {regs && regs.season2027.length > 0 && (
        <>
          <h3>Calendário da temporada 2027</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Evento</th>
                  <th scope="col">Local</th>
                  <th scope="col">Data</th>
                  <th scope="col">Regulação</th>
                </tr>
              </thead>
              <tbody>
                {regs.season2027.map((e, i) => (
                  <tr key={i}>
                    <td>{e.event ?? '—'}</td>
                    <td>{e.location ?? '—'}</td>
                    <td>{e.date ? (/^\d{4}-\d{2}-\d{2}/.test(e.date) ? formatDate(e.date) : e.date) : '—'}</td>
                    <td>{e.regulation ? `Reg ${e.regulation}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!regs && <p className="small muted">O calendário detalhado aparece aqui quando o arquivo regulations.json estiver disponível.</p>}
    </Card>
  );
}

function BattleRules() {
  const { data, regulation } = useApp();
  const { statPoints } = data.dex;
  const items = NOTABLE_ITEMS.map(id => data.dex.items[id] ?? { id, name: id, legal: {} as Record<string, boolean> });
  const available = items.filter(i => i.legal?.[regulation]);
  const missing = items.filter(i => !i.legal?.[regulation]);
  const rules: [string, ReactNode][] = [
    ['Nível', `${statPoints?.level ?? 50} (todos os Pokémon são ajustados); IVs fixos no máximo.`],
    ['Stat Points', `${statPoints?.total ?? 66} SP no total, no máximo ${statPoints?.maxPerStat ?? 32} por atributo; cada SP vale +1 no atributo.`],
    ['Naturezas', 'Existem normalmente (+10% em um atributo, −10% em outro).'],
    ['Terastal', 'Não existe no Champions.'],
    ['Mega Evolução', 'Permitida: só 1 Mega Evolução por batalha. Pode levar várias Mega Stones, mas mais de 2 costuma ser desperdício.'],
    ['Formato', 'Duplas: leva 6, escolhe 4 no preview.'],
    ['Cláusulas', 'Item Clause (sem itens repetidos) e Species Clause (sem espécies repetidas).'],
    ['Open Team Sheets', 'Espécies, itens, habilidades e golpes são visíveis ao oponente (SP e natureza não).'],
    ['Paralisia', 'Chance de 1/8 (12,5%) de não agir no turno; reduz a Velocidade pela metade.'],
    ['Sono e congelamento', 'Sono dura 2–3 turnos; congelamento dura no máximo 3 turnos.'],
  ];
  const extra = data.regulations?.battleRules;
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
      {extra && Object.keys(extra).length > 0 && (
        <>
          <h3>Detalhes da regulação (regulations.json)</h3>
          <GenericValue value={extra} />
        </>
      )}
      <h3>Itens notáveis na Reg {regulation}</h3>
      <div className="two-col">
        <div>
          <p className="small ok-text">Disponíveis</p>
          <p className="chips">
            {available.map(i => (
              <span key={i.id} className="tag tag-ok">
                {i.name}
              </span>
            ))}
          </p>
        </div>
        <div>
          <p className="small bad-text">Ausentes</p>
          <p className="chips">
            {missing.map(i => (
              <span key={i.id} className="tag tag-bad">
                {i.name}
              </span>
            ))}
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Renderiza objetos/arrays arbitrários (campos opcionais de JSON curado). */
function GenericValue({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.every(v => typeof v !== 'object' || v === null)) return value.map(String).join(', ');
    return (
      <ul className="generic-list">
        {value.map((v, i) => (
          <li key={i}>
            <GenericValue value={v} />
          </li>
        ))}
      </ul>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <dl className="generic">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            <GenericValue value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

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

function Patches() {
  const { data } = useApp();
  const versions = useMemo(
    () => [...(data.patches?.versions ?? [])].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    [data.patches],
  );
  return (
    <Card title="Histórico de patches (buffs e nerfs)">
      {!data.patches ? (
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
      {data.patches && data.patches.championsVsSV.length > 0 && (
        <details className="vs">
          <summary>Champions × Scarlet/Violet ({data.patches.championsVsSV.length} diferenças curadas)</summary>
          <ul className="changes">
            {data.patches.championsVsSV.map((c, i) =>
              c && typeof c === 'object' && ('notePt' in c || 'name' in c) ? (
                <ChangeLine key={i} c={c as PatchChange} />
              ) : (
                <li key={i}>
                  <GenericValue value={c} />
                </li>
              ),
            )}
          </ul>
        </details>
      )}
    </Card>
  );
}

function PatchItem({ v, open }: { v: PatchVersion; open: boolean }) {
  const changes = v.changes ?? [];
  const groups = ['buff', 'nerf', 'change'].map(d => ({ d, list: changes.filter(c => (c.direction ?? 'change') === d) }));
  const other = changes.filter(c => !['buff', 'nerf', 'change'].includes(c.direction ?? 'change'));
  const notes = Array.isArray(v.notesPt) ? v.notesPt : v.notesPt ? [v.notesPt] : [];
  return (
    <li className="patch">
      <details open={open}>
        <summary>
          <strong>Versão {v.version ?? '?'}</strong>
          <span className="small muted">
            {formatDate(v.date)}
            {v.regulation ? ` · Reg ${v.regulation}` : ''}
          </span>
          <span className="patch-counts small">
            {groups.map(g =>
              g.list.length ? (
                <span key={g.d} className={`dir dir-${g.d}`}>
                  {g.list.length} {DIRECTION_ONE[g.d]}
                  {g.list.length > 1 ? 's' : ''}
                </span>
              ) : null,
            )}
          </span>
        </summary>
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
                {g.list.map((c, i) => (
                  <ChangeLine key={i} c={c} />
                ))}
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
        {v.sources && v.sources.length > 0 && (
          <p className="small">
            Fontes:{' '}
            {v.sources.map((s, i) => {
              const url = typeof s === 'string' ? s : s.url;
              const label = typeof s === 'string' ? s.replace(/^https?:\/\//, '').slice(0, 60) : s.label ?? s.url;
              return (
                <span key={i}>
                  {i > 0 && ' · '}
                  {url && /^https?:/.test(url) ? (
                    <a href={url} target="_blank" rel="noreferrer noopener">
                      {label}
                    </a>
                  ) : (
                    label
                  )}
                </span>
              );
            })}
          </p>
        )}
      </details>
    </li>
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
      {['buff', 'nerf', 'change'].map(d => {
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

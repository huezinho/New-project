/** Aba "Meta": uso, cores, arquétipos e torneios recentes (com importação de times). */
import { useMemo, useState } from 'react';
import { pct, TYPE_PT } from '../../core/i18n.ts';
import { TYPES } from '../../core/typechart.ts';
import type { MetaPokemon, TournamentEvent, TournamentTeam, TypeName } from '../../core/types.ts';
import { Card, EmptyState, Notice } from '../components/common.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { TypeList } from '../components/TypeBadge.tsx';
import { useApp } from '../state.tsx';
import { formatDate, formatNumber, MAX_TEAM, matchesQuery, normalizeSet, tournamentMemberToSet } from '../util.ts';

type Section = 'uso' | 'cores' | 'arquetipos' | 'torneios';

export function MetaTab() {
  const { data, regulation } = useApp();
  const meta = data.meta;
  const [section, setSection] = useState<Section>('uso');
  const count = Object.keys(meta.pokemon).length;
  const empty = count === 0 && meta.events.length === 0 && meta.cores.length === 0;
  return (
    <div className="meta-tab">
      <div className="meta-head">
        <p className="muted small">
          Regulação dos dados: <strong>Reg {meta.regulation || '—'}</strong> · meia-vida de {meta.halfLifeDays} dias (torneios antigos contam, mas
          menos) · atualizado em {formatDate(meta.generatedAt)}
        </p>
        {meta.regulation && meta.regulation !== regulation && (
          <Notice kind="info">Você está vendo a Reg {regulation}, mas os dados de uso são da Reg {meta.regulation}.</Notice>
        )}
      </div>
      {empty ? (
        <EmptyState title="Sem dados de uso ainda" icon="◷">
          <p>
            Rode <code>npm run update-data</code> para baixar uso do ladder, torneios e replays. O GitHub Action diário também atualiza estes
            dados automaticamente.
          </p>
          {meta.notes.length > 0 && (
            <ul className="small muted">
              {meta.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="segmented" role="tablist" aria-label="Seções do meta">
            {(
              [
                ['uso', `Uso (${count})`],
                ['cores', `Cores (${meta.cores.length})`],
                ['arquetipos', `Arquétipos (${meta.archetypes.length})`],
                ['torneios', `Torneios (${meta.events.length})`],
              ] as [Section, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => setSection(id)}>
                {label}
              </button>
            ))}
          </div>
          {section === 'uso' && <UsageTable />}
          {section === 'cores' && <Cores />}
          {section === 'arquetipos' && <Archetypes />}
          {section === 'torneios' && <Events />}
        </>
      )}
    </div>
  );
}

type SortKey = 'rank' | 'name' | 'usage' | 'winRate' | 'topCut' | 'trend';

const trendDelta = (p: MetaPokemon) => (p.trend ? p.trend.recent - p.trend.previous : 0);

function Trend({ p }: { p: MetaPokemon }) {
  if (!p.trend) return <span className="muted">—</span>;
  const { recent, previous } = p.trend;
  const d = recent - previous;
  const title = `recente ${pct(recent)} · anterior ${pct(previous)}`;
  if (previous === 0 && recent > 0) return <span className="trend up" title={title}>▲ novo</span>;
  if (Math.abs(d) < 0.005) return <span className="trend flat" title={title}>→</span>;
  return (
    <span className={`trend ${d > 0 ? 'up' : 'down'}`} title={title}>
      {d > 0 ? '▲' : '▼'} {pct(Math.abs(d))}
    </span>
  );
}

function UsageTable() {
  const { data, dex, team, addSpecies } = useApp();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeName | ''>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [limit, setLimit] = useState(40);
  const teamNums = new Set(team.map(s => dex.species(s.species)?.num));

  const rows = useMemo(() => {
    const list = Object.values(data.meta.pokemon).filter(p => {
      const sp = dex.species(p.id);
      if (type && !sp?.types.includes(type)) return false;
      return matchesQuery(query, p.name, sp?.types.map(t => TYPE_PT[t]).join(' '));
    });
    const val = (p: MetaPokemon): number | string => {
      switch (sort.key) {
        case 'name': return p.name;
        case 'usage': return p.usage;
        case 'winRate': return p.winRate ?? -1;
        case 'topCut': return p.topCutRate ?? -1;
        case 'trend': return trendDelta(p);
        default: return p.rank;
      }
    };
    return list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * sort.dir || a.rank - b.rank;
    });
  }, [data.meta.pokemon, dex, query, type, sort]);

  const header = (key: SortKey, label: string, numeric = false) => {
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={numeric ? 'num' : ''}>
        <button
          type="button"
          className="sort-btn"
          onClick={() => setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'rank' || key === 'name' ? 1 : -1 }))}
        >
          {label}
          <span aria-hidden="true">{active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
        </button>
      </th>
    );
  };

  return (
    <Card title="Uso por Pokémon">
      <div className="filters">
        <label className="field">
          <span className="field-label">Buscar</span>
          <input className="input" type="search" value={query} placeholder="Nome ou tipo…" onChange={e => setQuery(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Tipo</span>
          <select className="input" value={type} onChange={e => setType(e.target.value as TypeName | '')}>
            <option value="">Todos</option>
            {TYPES.map(t => (
              <option key={t} value={t}>
                {TYPE_PT[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-wrap">
        <table className="data-table usage-table">
          <thead>
            <tr>
              {header('rank', '#', true)}
              {header('name', 'Pokémon')}
              {header('usage', 'Uso', true)}
              {header('winRate', 'Vitória', true)}
              {header('topCut', 'Top cut', true)}
              {header('trend', 'Tendência')}
              <th scope="col">Itens</th>
              <th scope="col">Golpes</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map(p => {
              const sp = dex.species(p.id);
              const inTeam = teamNums.has(sp?.num);
              return (
                <tr key={p.id}>
                  <td className="num muted">{p.rank}</td>
                  <td>
                    <span className="poke-cell">
                      <Sprite species={sp} name={p.name} size={32} />
                      <span>
                        <strong>{p.name}</strong>
                        <TypeList types={sp?.types} small />
                      </span>
                    </span>
                  </td>
                  <td className="num">
                    <strong>{pct(p.usage)}</strong>
                  </td>
                  <td className="num">
                    {pct(p.winRate)}
                    <span className="small muted block">{p.games ? `${formatNumber(p.games)} jogos` : ''}</span>
                  </td>
                  <td className="num">{pct(p.topCutRate)}</td>
                  <td>
                    <Trend p={p} />
                  </td>
                  <td className="small">
                    {p.items.slice(0, 2).map(i => (
                      <span key={i.id} className="block">
                        {i.name} <span className="muted">{pct(i.share, 0)}</span>
                      </span>
                    ))}
                  </td>
                  <td className="small">
                    {p.moves.slice(0, 4).map(m => (
                      <span key={m.id} className="block">
                        {m.name} <span className="muted">{pct(m.share, 0)}</span>
                      </span>
                    ))}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={inTeam || team.length >= MAX_TEAM || !dex.isLegal(sp)}
                      onClick={() => addSpecies(p.name)}
                      aria-label={`Adicionar ${p.name} à equipe`}
                    >
                      {inTeam ? '✓ na equipe' : '+ Equipe'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="muted">Nenhum Pokémon com esse filtro.</p>}
      {rows.length > limit && (
        <button type="button" className="btn btn-block" onClick={() => setLimit(l => l + 40)}>
          Mostrar mais ({rows.length - limit} restantes)
        </button>
      )}
    </Card>
  );
}

function Cores() {
  const { data, dex } = useApp();
  const [size, setSize] = useState<0 | 2 | 3>(0);
  const [limit, setLimit] = useState(40);
  const cores = data.meta.cores.filter(c => !size || c.members.length === size);
  return (
    <Card title="Cores (duplas e trios)" actions={<span className="muted small">Pokémon que aparecem juntos com frequência</span>}>
      <div className="segmented small-seg" role="radiogroup" aria-label="Tamanho do core">
        {(
          [
            [0, 'Todos'],
            [2, 'Duplas'],
            [3, 'Trios'],
          ] as [0 | 2 | 3, string][]
        ).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={size === v} className={size === v ? 'on' : ''} onClick={() => setSize(v)}>
            {label}
          </button>
        ))}
      </div>
      {cores.length === 0 ? (
        <p className="muted">Sem cores registrados.</p>
      ) : (
        <ul className="core-list">
          {cores.slice(0, limit).map(c => (
            <li key={c.members.join('|')} className="core">
              <span className="core-members">
                {c.members.map(id => {
                  const sp = dex.species(id);
                  return <Sprite key={id} species={sp} name={id} size={36} />;
                })}
              </span>
              <span className="core-names">{c.members.map(id => dex.species(id)?.name ?? id).join(' + ')}</span>
              <span className="core-stats small">
                <span>uso {pct(c.usage)}</span>
                <span>vitória {pct(c.winRate)}</span>
                <span className="muted">{c.games ? `${formatNumber(c.games)} jogos` : 'sem jogos'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {cores.length > limit && (
        <button type="button" className="btn btn-block" onClick={() => setLimit(l => l + 40)}>
          Mostrar mais
        </button>
      )}
    </Card>
  );
}

function Archetypes() {
  const { data, dex } = useApp();
  if (!data.meta.archetypes.length) return <p className="muted">Sem arquétipos registrados nos dados de meta.</p>;
  return (
    <div className="arch-grid">
      {data.meta.archetypes.map(a => (
        <Card key={a.id} title={a.namePt || a.name} actions={a.share ? <span className="usage">{pct(a.share)}</span> : null}>
          <div className="core-members">
            {a.keyMembers.map(m => (
              <Sprite key={m} species={dex.species(m)} name={m} size={40} />
            ))}
          </div>
          <p className="small">{a.keyMembers.map(m => dex.species(m)?.name ?? m).join(', ')}</p>
          {a.description && <p className="small muted">{a.description}</p>}
        </Card>
      ))}
    </div>
  );
}

const TIER_PT: Record<string, string> = {
  worlds: 'Mundial', international: 'Internacional', regional: 'Regional', special: 'Especial', online: 'Online', official: 'Oficial',
};

function Events() {
  const { data } = useApp();
  const regs = [...new Set(data.meta.events.map(e => e.regulation))];
  const [reg, setReg] = useState('');
  const [query, setQuery] = useState('');
  const events = data.meta.events.filter(e => (!reg || e.regulation === reg) && matchesQuery(query, e.name, e.game));
  return (
    <Card title="Torneios recentes">
      <div className="filters">
        <label className="field">
          <span className="field-label">Buscar</span>
          <input className="input" type="search" value={query} placeholder="Nome do torneio…" onChange={e => setQuery(e.target.value)} />
        </label>
        {regs.length > 1 && (
          <label className="field">
            <span className="field-label">Regulação</span>
            <select className="input" value={reg} onChange={e => setReg(e.target.value)}>
              <option value="">Todas</option>
              {regs.map(r => (
                <option key={r} value={r}>
                  Reg {r}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {events.length === 0 ? (
        <p className="muted">Nenhum torneio encontrado.</p>
      ) : (
        <ul className="events">
          {events.map(e => (
            <EventItem key={e.id} event={e} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function EventItem({ event }: { event: TournamentEvent }) {
  return (
    <li className="event">
      <details>
        <summary>
          <span className="event-name">{event.name}</span>
          <span className="event-meta small">
            <span>{formatDate(event.date)}</span>
            <span className="tag">Reg {event.regulation}</span>
            {event.game && event.game !== 'Champions' && <span className="tag tag-warn">{event.game}</span>}
            <span className="tag">{TIER_PT[event.tier] ?? event.tier}</span>
            {event.players ? <span>{formatNumber(event.players)} jogadores</span> : null}
            <span className="muted">{event.teams.length} times</span>
          </span>
        </summary>
        {event.url && (
          <p className="small">
            <a href={event.url} target="_blank" rel="noreferrer noopener">
              Ver resultados completos ↗
            </a>
          </p>
        )}
        <ol className="event-teams">
          {event.teams.map((t, i) => (
            <EventTeam key={`${t.player}-${i}`} team={t} event={event} />
          ))}
        </ol>
      </details>
    </li>
  );
}

function EventTeam({ team, event }: { team: TournamentTeam; event: TournamentEvent }) {
  const { dex, createTeam, goTab } = useApp();
  const [done, setDone] = useState(false);
  const importTeam = () => {
    const sets = team.pokemon.slice(0, MAX_TEAM).map(m => normalizeSet(dex, tournamentMemberToSet(m)).set);
    createTeam(`${team.player} — ${event.name}`.slice(0, 60), sets);
    setDone(true);
    goTab('equipe');
  };
  return (
    <li className="event-team">
      <div className="event-team-head">
        <span className="placing">{team.placing ? `#${team.placing}` : '—'}</span>
        <span className="player">
          {team.player}
          {team.country ? <span className="muted small"> ({team.country})</span> : null}
        </span>
        {team.record && (
          <span className="small muted">
            {team.record.wins}V-{team.record.losses}D{team.record.ties ? `-${team.record.ties}E` : ''}
          </span>
        )}
        <button type="button" className="btn btn-sm" onClick={importTeam} disabled={!team.pokemon.length}>
          {done ? '✓ Importado' : 'Importar para o construtor'}
        </button>
      </div>
      <ul className="event-mons">
        {team.pokemon.map((m, i) => {
          const sp = dex.species(m.species);
          return (
            <li key={`${m.species}-${i}`} title={[m.ability, ...(m.moves ?? [])].filter(Boolean).join(' · ')}>
              <Sprite species={sp} name={m.species} size={36} />
              <span className="small">
                <strong>{sp?.name ?? m.species}</strong>
                {m.item && <span className="muted block">@ {m.item}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** Aba "Fontes de dados": de onde vêm os números e como atualizar. */
import { useMemo, useState } from 'react';
import { Card, Notice, ScoreBar } from '../components/common.tsx';
import { eventNamePt } from '../eventNames.ts';
import { useApp } from '../state.tsx';
import { formatDate, formatLooseDate, formatNumber, matchesQuery, relativeAge } from '../util.ts';

const SOURCE_KIND_PT: Record<string, string> = {
  usage: 'Uso (ladder)',
  tournament: 'Torneio',
  replays: 'Replays',
  seed: 'Semente (pesquisa)',
};

const pctPt = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')}%`;

export function SourcesTab() {
  const { data } = useApp();
  const { dex, meta, heuristics } = data;
  const commitUrl = dex.source?.commit && dex.source.repo ? `https://github.com/${dex.source.repo}/commit/${dex.source.commit}` : null;
  return (
    <div className="sources">
      <div className="two-col">
        <Card title="Banco de dados do jogo (dex.json)">
          <dl className="kv">
            <div>
              <dt>Origem</dt>
              <dd>
                {dex.source?.repo ?? '—'} · mod <code>{dex.source?.mod ?? 'champions'}</code> ({dex.source?.ref ?? '—'})
              </dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                {commitUrl ? (
                  <a href={commitUrl} target="_blank" rel="noreferrer noopener">
                    <code>{dex.source.commit!.slice(0, 10)}</code> ↗
                  </a>
                ) : (
                  <span className="muted">desconhecido</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Gerado em</dt>
              <dd>
                {formatDate(dex.generatedAt)} <span className="muted">({relativeAge(dex.generatedAt)})</span>
              </dd>
            </div>
            <div>
              <dt>Conteúdo</dt>
              <dd>
                {formatNumber(Object.keys(dex.species).length)} espécies/formas · {formatNumber(Object.keys(dex.moves).length)} golpes ·{' '}
                {formatNumber(Object.keys(dex.abilities).length)} habilidades · {formatNumber(Object.keys(dex.items).length)} itens
              </dd>
            </div>
            <div>
              <dt>Regulações</dt>
              <dd>{dex.formats.map(f => `Reg ${f.regulation}${f.current ? ' (atual)' : ''}`).join(', ') || '—'}</dd>
            </div>
          </dl>
          <p className="small muted">
            O Pokémon Showdown mantém um mod <code>champions</code> atualizado a cada patch do jogo. O atualizador lê esses arquivos sem
            executar código baixado e extrai espécies, golpes, habilidades, itens, learnsets e legalidade por regulação.
          </p>
        </Card>
        <Card title="Meta (meta.json)">
          <dl className="kv">
            <div>
              <dt>Regulação</dt>
              <dd>
                Reg {meta.regulation || '—'} {meta.formatId && <code className="small">{meta.formatId}</code>}
              </dd>
            </div>
            <div>
              <dt>Gerado em</dt>
              <dd>
                {formatDate(meta.generatedAt)} <span className="muted">({relativeAge(meta.generatedAt)})</span>
              </dd>
            </div>
            <div>
              <dt>Cobertura</dt>
              <dd>
                {formatNumber(Object.keys(meta.pokemon).length)} Pokémon · {formatNumber(meta.cores.length)} cores · {formatNumber(meta.archetypes.length)}{' '}
                arquétipos · {formatNumber(meta.events.length)} torneios
              </dd>
            </div>
            <div>
              <dt>Decaimento</dt>
              <dd>meia-vida de {meta.halfLifeDays} dias (peso = 0,5 ^ idade/meia-vida)</dd>
            </div>
            <div>
              <dt>Heurísticas</dt>
              <dd>
                {heuristics.roles.length} papéis · {heuristics.archetypes.length} arquétipos · {heuristics.moveHeuristics.length} regras de golpes
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <MetaSources />
      <CuratedFiles />

      <Card title="Como os dados são ponderados">
        <ul className="notes">
          <li>
            <strong>Tempo:</strong> torneios antigos contam, mas menos — o peso cai pela metade a cada {meta.halfLifeDays} dias.
          </li>
          <li>
            <strong>Regulação:</strong> atual = 1,0; anterior do Champions = 0,35; mais antigas = 0,15; era Scarlet/Violet = 0,05.
          </li>
          <li>
            <strong>Patches:</strong> partidas anteriores a um patch que alterou a espécie, um golpe ou habilidade dela valem metade.
          </li>
          <li>
            <strong>Tipo de fonte:</strong> torneio oficial &gt; torneio online &gt; ladder alto &gt; ladder geral.
          </li>
          <li>
            <strong>Taxa de vitória:</strong> encolhimento bayesiano (V + 20·0,5) / (J + 20), para poucas partidas não gerarem números extremos.
          </li>
        </ul>
      </Card>

      <Card title="Como atualizar">
        <ol className="notes">
          <li>
            Localmente: <code>npm run update-data</code> (baixa o mod do Showdown, uso da Smogon, torneios da Limitless e sementes).
          </li>
          <li>
            Automaticamente: o GitHub Action <code>.github/workflows/update-data.yml</code> roda todo dia e faz commit dos JSON quando algo muda.
          </li>
          <li>Quando sair uma nova regulação ou patch, o atualizador detecta o novo formato e as mudanças de golpes/itens automaticamente.</li>
        </ol>
      </Card>
    </div>
  );
}

function MetaSources() {
  const { data } = useApp();
  const { meta } = data;
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(15);
  const totalWeight = meta.sources.reduce((a, s) => a + (s.weight || 0), 0) || 1;
  const kinds = useMemo(() => {
    const m = new Map<string, { kind: string; count: number; samples: number; weight: number }>();
    for (const s of meta.sources) {
      const k = m.get(s.kind) ?? { kind: s.kind, count: 0, samples: 0, weight: 0 };
      k.count++;
      k.samples += s.samples || 0;
      k.weight += s.weight || 0;
      m.set(s.kind, k);
    }
    return [...m.values()].sort((a, b) => b.weight - a.weight);
  }, [meta.sources]);
  const rows = useMemo(
    () =>
      meta.sources
        .filter(s => (!kind || s.kind === kind) && matchesQuery(query, s.label, s.period, s.regulation))
        .sort((a, b) => (b.weight || 0) - (a.weight || 0)),
    [meta.sources, kind, query],
  );
  return (
    <Card title="Fontes usadas no meta" actions={<span className="muted small">{formatNumber(meta.sources.length)} fontes</span>}>
      {meta.sources.length === 0 ? (
        <Notice kind="info">
          Nenhuma fonte de uso foi agregada ainda. Rode <code>npm run update-data</code>.
        </Notice>
      ) : (
        <>
          <ul className="kind-tiles">
            {kinds.map(k => (
              <li key={k.kind}>
                <span className="kind-name">{SOURCE_KIND_PT[k.kind] ?? k.kind}</span>
                <strong className="kind-value">{formatNumber(k.count)}</strong>
                <span className="small muted">
                  {formatNumber(k.samples)} amostras · {pctPt(k.weight / totalWeight)} do peso
                </span>
                <ScoreBar value={k.weight / totalWeight} tone="good" label={`${pctPt(k.weight / totalWeight)} do peso total`} />
              </li>
            ))}
          </ul>
          <div className="filters">
            <label className="field">
              <span className="field-label">Buscar fonte</span>
              <input className="input" type="search" value={query} placeholder="Nome do torneio, período…" onChange={e => setQuery(e.target.value)} />
            </label>
            {kinds.length > 1 && (
              <label className="field">
                <span className="field-label">Tipo</span>
                <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
                  <option value="">Todos</option>
                  {kinds.map(k => (
                    <option key={k.kind} value={k.kind}>
                      {SOURCE_KIND_PT[k.kind] ?? k.kind}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table className="data-table stack">
              <thead>
                <tr>
                  <th scope="col">Fonte</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Regulação</th>
                  <th scope="col">Período</th>
                  <th scope="col" className="num">
                    Amostras
                  </th>
                  <th scope="col" className="num">
                    Peso
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map(s => (
                  <tr key={`${s.id}-${s.period ?? ''}`}>
                    <td className="stack-title" title={s.label}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {eventNamePt(s.label)}
                        </a>
                      ) : (
                        eventNamePt(s.label)
                      )}
                    </td>
                    <td data-label="Tipo">{SOURCE_KIND_PT[s.kind] ?? s.kind}</td>
                    <td data-label="Regulação">Reg {s.regulation}</td>
                    <td className="small" data-label="Período">
                      {formatLooseDate(s.period)}
                    </td>
                    <td className="num" data-label="Amostras">
                      {formatNumber(s.samples)}
                    </td>
                    <td className="num" data-label="Peso" title={`peso bruto ${(s.weight ?? 0).toFixed(3)}`}>
                      {pctPt((s.weight || 0) / totalWeight)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="muted small">Nenhuma fonte com esse filtro.</p>}
          {rows.length > limit && (
            <button type="button" className="btn btn-block" onClick={() => setLimit(rows.length)}>
              Mostrar todas ({rows.length})
            </button>
          )}
        </>
      )}
      {meta.notes.length > 0 && (
        <>
          <h3>Observações do agregador</h3>
          <ul className="notes">
            {meta.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function CuratedFiles() {
  const { data } = useApp();
  const { patches, regulations } = data;
  return (
    <Card title="Pesquisa curada (patches e regulações)">
      <dl className="kv">
        <div>
          <dt>patches.json</dt>
          <dd>
            {patches ? (
              <>
                {patches.versions.length} versões do jogo · {patches.championsVsSV.length} diferenças Champions × SV ·{' '}
                {patches.simulatorFixes.length} correções do simulador
                {patches.meta?.generatedAt ? ` · pesquisado em ${formatLooseDate(patches.meta.generatedAt)}` : ''}
                {patches.meta?.showdownCommit ? (
                  <>
                    {' '}
                    · Showdown <code>{patches.meta.showdownCommit}</code>
                  </>
                ) : null}
              </>
            ) : (
              <span className="muted">não encontrado (opcional)</span>
            )}
          </dd>
        </div>
        <div>
          <dt>regulations.json</dt>
          <dd>
            {regulations ? (
              <>
                Reg {regulations.currentRegulation ?? '—'} atual · {regulations.regulations.length} regulações · {regulations.season2027.length} eventos da
                temporada 2027 · {regulations.itemsAvailability.length} itens verificados
                {regulations.generatedAt ? ` · pesquisado em ${formatLooseDate(regulations.generatedAt)}` : ''}
              </>
            ) : (
              <span className="muted">não encontrado (opcional)</span>
            )}
          </dd>
        </div>
      </dl>
      {patches?.meta?.notePt && <p className="small muted">{patches.meta.notePt}</p>}
      <p className="small muted">
        Estes arquivos são pesquisa manual (notas oficiais, Showdown, sites da comunidade) e complementam os dados automáticos. Datas e eventos
        futuros podem mudar: confira sempre o site oficial do Play! Pokémon.
      </p>
    </Card>
  );
}

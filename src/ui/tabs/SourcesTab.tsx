/** Aba "Fontes de dados": de onde vêm os números e como atualizar. */
import { Card, Notice } from '../components/common.tsx';
import { useApp } from '../state.tsx';
import { formatDate, formatNumber, relativeAge } from '../util.ts';

const SOURCE_KIND_PT: Record<string, string> = {
  usage: 'Uso (ladder)',
  tournament: 'Torneio',
  replays: 'Replays',
  seed: 'Semente (pesquisa)',
};

export function SourcesTab() {
  const { data } = useApp();
  const { dex, meta, heuristics } = data;
  const commitUrl = dex.source?.commit && dex.source.repo ? `https://github.com/${dex.source.repo}/commit/${dex.source.commit}` : null;
  const totalWeight = meta.sources.reduce((a, s) => a + (s.weight || 0), 0) || 1;
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
                {formatNumber(Object.keys(meta.pokemon).length)} Pokémon · {formatNumber(meta.cores.length)} cores · {formatNumber(meta.events.length)}{' '}
                torneios
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

      <Card title="Fontes usadas no meta">
        {meta.sources.length === 0 ? (
          <Notice kind="info">Nenhuma fonte de uso foi agregada ainda. Rode <code>npm run update-data</code>.</Notice>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Fonte</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Regulação</th>
                  <th scope="col">Período</th>
                  <th scope="col" className="num">Amostras</th>
                  <th scope="col" className="num">Peso</th>
                </tr>
              </thead>
              <tbody>
                {meta.sources.map(s => (
                  <tr key={`${s.id}-${s.period ?? ''}`}>
                    <td>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                    </td>
                    <td>{SOURCE_KIND_PT[s.kind] ?? s.kind}</td>
                    <td>Reg {s.regulation}</td>
                    <td className="small">{s.period ?? '—'}</td>
                    <td className="num">{formatNumber(s.samples)}</td>
                    <td className="num" title={`peso bruto ${s.weight.toFixed(3)}`}>
                      {((s.weight / totalWeight) * 100).toFixed(1).replace('.', ',')}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

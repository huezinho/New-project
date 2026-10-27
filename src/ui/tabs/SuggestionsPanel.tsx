/** Painel lateral: sugestões de Pokémon para completar a equipe e ajuste de pesos. */
import { useState } from 'react';
import type { PokemonSuggestion, SuggestionWeights } from '../../core/api.ts';
import { DEFAULT_WEIGHTS } from '../../core/engine.ts';
import { pct } from '../../core/i18n.ts';
import { Card, EmptyState, EngineNotice, Notice, Reasons, ScoreBar } from '../components/common.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { TypeList } from '../components/TypeBadge.tsx';
import { runAutoComplete, runPokemon, type Safe } from '../engineBridge.ts';
import { useApp } from '../state.tsx';
import { displayName, displayScore, MAX_TEAM, normalizeSet, sanitizeSet } from '../util.ts';

export const WEIGHT_INFO: Record<keyof SuggestionWeights, { label: string; help: string }> = {
  meta: { label: 'Uso no meta', help: 'Percentil de uso ponderado (torneios e ladder recentes pesam mais).' },
  winRate: { label: 'Taxa de vitória', help: 'Vitória ajustada; só pesa quando há amostra suficiente.' },
  synergy: { label: 'Sinergia', help: 'Parcerias frequentes e vencedoras com os membros atuais.' },
  defensive: { label: 'Defesa', help: 'Cobre as fraquezas compartilhadas da equipe.' },
  offensive: { label: 'Cobertura ofensiva', help: 'Acerta super efetivo tipos que a equipe ainda não acerta.' },
  roles: { label: 'Papéis', help: 'Cumpre papéis que faltam (Fake Out, controle de velocidade, redirecionamento...).' },
  threats: { label: 'Ameaças', help: 'Responde às ameaças mais usadas do meta.' },
  archetype: { label: 'Arquétipo', help: 'Encaixa no modo de jogo detectado (Trick Room, Tailwind, sol, chuva...).' },
};

export function SuggestionsPanel() {
  const { bridge, dex, data, team, setTeam, engineTeam, engineKey, pending, addSpecies, setSelected } = useApp();
  const [autoError, setAutoError] = useState<Safe<unknown> | null>(null);
  const full = team.length >= MAX_TEAM;
  const res = runPokemon(bridge, engineTeam, engineKey, 12);

  // sem motor: usa os mais usados do meta que ainda não estão na equipe
  const fallback: PokemonSuggestion[] = res.ok
    ? []
    : Object.values(data.meta.pokemon)
        .filter(p => !team.some(s => dex.species(s.species)?.num === dex.species(p.id)?.num) && dex.isLegal(dex.species(p.id)))
        .sort((a, b) => b.usage - a.usage)
        .slice(0, 8)
        .map(p => ({
          species: p.name, score: Math.min(1, p.usage * 2), components: [], meta: p,
          reasonsPt: [`Muito usado no meta (${pct(p.usage)} das equipes).`], set: { species: p.name, sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moves: [] },
        }));
  const list = res.ok ? res.value : fallback;

  const add = (s: PokemonSuggestion) => {
    if (full) return;
    const raw = sanitizeSet(s.set);
    if (res.ok && raw && dex.species(raw.species)) {
      setTeam([...team, normalizeSet(dex, raw).set]);
      setSelected(team.length);
    } else addSpecies(displayName(dex, 'species', s.species));
  };

  const autoComplete = () => {
    const r = runAutoComplete(bridge, team);
    if (r.ok && r.value.length >= team.length) {
      setTeam(r.value);
      setAutoError(null);
    } else setAutoError(r.ok ? { ok: false, error: 'resposta inválida do motor' } : r);
  };

  return (
    <>
      <Card
        title="Sugestões para completar a equipe"
        className="side-card"
        actions={pending ? <span className="muted small" aria-live="polite">atualizando…</span> : null}
      >
        <button type="button" className="btn btn-primary btn-block" disabled={full} onClick={autoComplete}>
          {full ? 'Equipe completa (6/6)' : `Completar equipe automaticamente (${team.length}/6)`}
        </button>
        {autoError && <EngineNotice result={autoError} what="Completar automaticamente" />}
        <EngineNotice
          result={res}
          what="Sugestões do motor"
          fallback={fallback.length ? 'Mostrando os Pokémon mais usados no meta como alternativa.' : undefined}
        />
        {full && <Notice kind="info">Equipe completa. Remova um membro para adicionar uma sugestão.</Notice>}
        {list.length === 0 ? (
          <EmptyState title="Sem sugestões por enquanto">
            <p>Quando houver dados de uso (npm run update-data) ou o motor estiver ativo, as sugestões aparecem aqui.</p>
          </EmptyState>
        ) : (
          <ol className="sugg-list">
            {list.map((s, i) => (
              <SuggestionCard key={s.species} s={s} rank={i + 1} disabled={full} onAdd={() => add(s)} />
            ))}
          </ol>
        )}
      </Card>
      <WeightsPanel />
    </>
  );
}

function SuggestionCard({ s, rank, disabled, onAdd }: { s: PokemonSuggestion; rank: number; disabled: boolean; onAdd: () => void }) {
  const { dex } = useApp();
  const species = dex.species(s.species);
  const setForm = s.set ? dex.battleForm(s.set) : undefined;
  const form = setForm ?? species;
  const score = displayScore(s.score);
  const name = species?.name ?? s.species;
  return (
    <li className="sugg">
      <div className="sugg-head">
        <span className="sugg-rank" aria-hidden="true">{rank}</span>
        <Sprite species={form} name={name} size={48} />
        <div className="sugg-id">
          <strong>{name}</strong>
          <TypeList types={form?.types} small />
          {setForm?.isMega && <span className="tag tag-mega">{setForm.name}</span>}
        </div>
        <span className="sugg-score" title="Pontuação (0-100)">{score}</span>
      </div>
      <ScoreBar value={score / 100} label={`Pontuação ${score} de 100`} />
      <Reasons items={s.reasonsPt} max={3} />
      {s.components.length > 0 && (
        <details className="components">
          <summary>Detalhes da pontuação</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Critério</th>
                <th scope="col">Valor</th>
                <th scope="col" className="num">Peso</th>
              </tr>
            </thead>
            <tbody>
              {s.components.map(c => (
                <tr key={c.key}>
                  <th scope="row">{c.labelPt || WEIGHT_INFO[c.key]?.label || c.key}</th>
                  <td>
                    <ScoreBar value={c.value} tone="good" />
                    <span className="small muted"> {Math.round(c.value * 100)}</span>
                  </td>
                  <td className="num small">{Math.round(c.weight * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="sugg-foot">
        <span className="small muted">
          {s.meta ? `uso ${pct(s.meta.usage)}` : 'sem dados de uso'}
          {s.meta?.winRate !== null && s.meta?.winRate !== undefined ? ` · vitória ${pct(s.meta.winRate)}` : ''}
        </span>
        <button type="button" className="btn btn-sm btn-primary" disabled={disabled} onClick={onAdd} aria-label={`Adicionar ${name} à equipe`}>
          Adicionar
        </button>
      </div>
    </li>
  );
}

function WeightsPanel() {
  const { weights, setWeights } = useApp();
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof SuggestionWeights)[];
  const sum = keys.reduce((a, k) => a + weights[k], 0) || 1;
  const isDefault = keys.every(k => Math.abs(weights[k] - DEFAULT_WEIGHTS[k]) < 1e-6);
  return (
    <details className="card side-card weights">
      <summary>
        <span className="card-title">Ajustar prioridades</span>
        <span className="muted small">{isDefault ? 'padrão' : 'personalizado'}</span>
      </summary>
      <p className="muted small">Defina o quanto cada critério pesa nas sugestões. A escolha fica salva neste navegador.</p>
      <div className="weights-list">
        {keys.map(k => {
          const id = `w-${k}`;
          return (
            <div key={k} className="weight-row">
              <label htmlFor={id} title={WEIGHT_INFO[k].help}>
                {WEIGHT_INFO[k].label}
                <span className="muted small"> · {Math.round((weights[k] / sum) * 100)}% do total</span>
              </label>
              <input
                id={id}
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(weights[k] * 100)}
                onChange={e => setWeights({ ...weights, [k]: Number(e.target.value) / 100 })}
                aria-describedby={`${id}-help`}
              />
              <span className="num small">{Math.round(weights[k] * 100)}</span>
              <span id={`${id}-help`} className="sr-only">
                {WEIGHT_INFO[k].help}
              </span>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn-sm" disabled={isDefault} onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>
        Restaurar padrão
      </button>
    </details>
  );
}

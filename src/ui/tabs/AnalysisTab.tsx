/** Aba "Análise": matriz defensiva, cobertura, papéis, arquétipos, velocidades, ameaças e problemas. */
import { useState } from 'react';
import type { CoverageRow, SpeedEntry, TeamAnalysis, TeamIssue, TypeMatchupRow } from '../../core/api.ts';
import { pct, TYPE_PT } from '../../core/i18n.ts';
import { effectiveSpeed, totalSP, validateSP } from '../../core/stats.ts';
import type { Team } from '../../core/types.ts';
import { Card, EmptyState, EngineNotice, Reasons, ScoreBar } from '../components/common.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { TypeBadge } from '../components/TypeBadge.tsx';
import { runAnalysis } from '../engineBridge.ts';
import { simpleDefensive, simpleOffensive, simpleSpeed } from '../fallback.ts';
import { useApp } from '../state.tsx';
import { formatMult, itemClauseConflicts, megaStoneCount, multClass, speciesClauseConflicts } from '../util.ts';
import type { DexAccess } from '../../core/dex.ts';

export function AnalysisTab() {
  const { bridge, data, dex, engineTeam, engineKey, goTab, pending } = useApp();
  if (!engineTeam.length) {
    return (
      <EmptyState title="Nenhum Pokémon na equipe" icon="◔">
        <p>Adicione Pokémon na aba Equipe para ver fraquezas, cobertura, papéis, velocidades e ameaças.</p>
        <button type="button" className="btn btn-primary" onClick={() => goTab('equipe')}>
          Ir para Equipe
        </button>
      </EmptyState>
    );
  }
  const res = runAnalysis(bridge, engineTeam, engineKey);
  const a: TeamAnalysis | null = res.ok ? res.value : null;
  const defensive = a?.defensive?.length ? a.defensive : simpleDefensive(dex, engineTeam);
  const offensive = a?.offensive?.length ? a.offensive : simpleOffensive(dex, engineTeam);
  const speed = a?.speedTiers?.length ? a.speedTiers : simpleSpeed(dex, engineTeam, data.meta);
  const issues = a ? a.issues ?? [] : localIssues(dex, engineTeam);

  return (
    <div className="analysis">
      {pending && <p className="muted small" aria-live="polite">Atualizando análise…</p>}
      <EngineNotice result={res} what="Análise completa" fallback="Mostrando uma análise simplificada (tipos, cobertura e velocidade) calculada localmente." />
      <div className="analysis-top">
        {a && <ScoreCard analysis={a} />}
        <Card title="Problemas e avisos" className="issues-card">
          <IssuesList issues={issues} team={engineTeam} />
        </Card>
      </div>
      <Card title="Matriz defensiva" actions={<span className="muted small">dano recebido por tipo de ataque</span>}>
        <DefensiveMatrix rows={defensive} team={engineTeam} />
      </Card>
      <Card title="Cobertura ofensiva" actions={<span className="muted small">melhor multiplicador dos golpes de dano</span>}>
        <Coverage rows={offensive} />
      </Card>
      {a && (
        <div className="two-col">
          <Card title="Papéis da equipe">
            <RolesChecklist analysis={a} />
          </Card>
          <Card title="Arquétipos detectados">
            {a.archetypes.length === 0 ? (
              <p className="muted">Nenhum arquétipo claro (equipe "goodstuffs"/balanceada).</p>
            ) : (
              <ul className="arch-list">
                {a.archetypes.map(x => (
                  <li key={x.def.id}>
                    <div className="row-between">
                      <strong>{x.def.namePt}</strong>
                      <span className="small muted">{Math.round(x.confidence * 100)}% de confiança</span>
                    </div>
                    <ScoreBar value={x.confidence} tone="good" />
                    {x.via.length > 0 && <p className="small">Via: {x.via.join(', ')}</p>}
                    {x.def.description && <p className="small muted">{x.def.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <Card title="Tiers de velocidade">
        <SpeedTiers entries={speed} />
      </Card>
      {a && (
        <Card title="Ameaças do meta">
          <Threats analysis={a} />
        </Card>
      )}
    </div>
  );
}

/** Problemas básicos calculados na interface quando o motor falha. */
function localIssues(dex: DexAccess, team: Team): TeamIssue[] {
  const out: TeamIssue[] = [];
  const items = itemClauseConflicts(team);
  const species = speciesClauseConflicts(dex, team);
  team.forEach((s, slot) => {
    const sp = dex.species(s.species);
    if (!sp) out.push({ severity: 'error', slot, messagePt: `Espécie desconhecida: ${s.species}.` });
    else if (!dex.isLegal(sp)) out.push({ severity: 'error', slot, messagePt: `${sp.name} não é legal na Reg ${dex.regulation}.` });
    if (items.has(slot)) out.push({ severity: 'error', slot, messagePt: `${s.species}: item repetido (${s.item}) — Item Clause.` });
    if (species.has(slot)) out.push({ severity: 'error', slot, messagePt: `${s.species}: espécie repetida — Species Clause.` });
    for (const p of validateSP(s.sp)) out.push({ severity: 'error', slot, messagePt: `${s.species}: ${p}` });
    if (totalSP(s.sp) < 66) out.push({ severity: 'info', slot, messagePt: `${s.species}: ${66 - totalSP(s.sp)} SP sem uso.` });
    if (s.moves.length < 4) out.push({ severity: 'warn', slot, messagePt: `${s.species}: só ${s.moves.length} golpe(s).` });
    if (!s.item) out.push({ severity: 'info', slot, messagePt: `${s.species}: sem item.` });
  });
  if (megaStoneCount(dex, team) > 2) out.push({ severity: 'warn', messagePt: 'Mais de 2 Mega Stones: só uma Mega Evolução por batalha.' });
  if (team.length < 6) out.push({ severity: 'info', messagePt: `Equipe com ${team.length}/6 Pokémon.` });
  return out;
}

function ScoreCard({ analysis }: { analysis: TeamAnalysis }) {
  // contrato: nota de 0 a 100
  const score = Math.max(0, Math.min(100, Math.round(Number(analysis.score) || 0)));
  const tone = score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad';
  return (
    <Card title="Nota geral" className="score-card">
      <div className="score-wrap">
        <div className={`score-ring ${tone}`} style={{ ['--p' as string]: `${score}` }} role="img" aria-label={`Nota ${score} de 100`}>
          <span>{score}</span>
          <small>/100</small>
        </div>
        <ul className="summary">
          {analysis.summaryPt.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

const SEVERITY_LABEL: Record<TeamIssue['severity'], string> = { error: 'Erro', warn: 'Atenção', info: 'Info' };

function IssuesList({ issues, team }: { issues: TeamIssue[]; team: Team }) {
  if (!issues.length) return <p className="ok-text">✓ Nenhum problema encontrado.</p>;
  const order = { error: 0, warn: 1, info: 2 } as const;
  return (
    <ul className="issues">
      {[...issues]
        .sort((a, b) => order[a.severity] - order[b.severity])
        .map((i, k) => {
          const who = i.slot !== undefined ? team[i.slot]?.species : undefined;
          const text = who && i.messagePt.startsWith(`${who}:`) ? i.messagePt.slice(who.length + 1).trim() : i.messagePt;
          return (
            <li key={k} className={`issue issue-${i.severity}`}>
              <span className="issue-tag">{SEVERITY_LABEL[i.severity] ?? i.severity}</span>
              <span>
                {who ? <strong>{who}: </strong> : null}
                {text}
              </span>
            </li>
          );
        })}
    </ul>
  );
}

const STATUS_LABEL: Record<TypeMatchupRow['status'], string> = { ok: 'ok', warn: 'atenção', bad: 'problema' };

function DefensiveMatrix({ rows, team }: { rows: TypeMatchupRow[]; team: Team }) {
  const { dex } = useApp();
  return (
    <>
      <div className="table-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th scope="col">Ataque</th>
              {team.map((s, i) => {
                const form = dex.battleForm(s) ?? dex.species(s.species);
                return (
                  <th key={i} scope="col" title={form?.name ?? s.species}>
                    <Sprite species={form} name={s.species} size={32} />
                    <span className="sr-only">{form?.name ?? s.species}</span>
                  </th>
                );
              })}
              <th scope="col" className="tot" title="Membros fracos">Fracos</th>
              <th scope="col" className="tot" title="Membros que resistem">Resist.</th>
              <th scope="col" className="tot" title="Membros imunes">Imunes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.type} className={`st-${r.status}`}>
                <th scope="row" title={r.abilityNotes.length ? `Habilidades: ${r.abilityNotes.join('; ')}` : undefined}>
                  <TypeBadge type={r.type} small />
                  {r.abilityNotes.length > 0 && <span className="ab-mark" aria-label={`Habilidades: ${r.abilityNotes.join('; ')}`}>★</span>}
                  {r.status !== 'ok' && <span className="sr-only"> ({STATUS_LABEL[r.status]})</span>}
                </th>
                {r.multipliers.map((m, i) => (
                  <td key={i} className={`mcell ${multClass(m)}`}>
                    {m === 1 ? <span className="sr-only">1×</span> : `${formatMult(m)}×`}
                  </td>
                ))}
                <td className={`tot ${r.weak >= 3 ? 'bad' : r.weak >= 2 ? 'warn' : ''}`}>{r.weak}</td>
                <td className="tot">{r.resist}</td>
                <td className="tot">{r.immune}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend" aria-label="Legenda">
        <span className="mcell m-imm">0×</span> imune <span className="mcell m-q">¼×</span>
        <span className="mcell m-h">½×</span> resiste <span className="mcell m-2x">2×</span>
        <span className="mcell m-4x">4×</span> fraco <span className="legend-row st-warn">atenção</span>
        <span className="legend-row st-bad">problema</span> <span className="small muted">★ = habilidade altera o dano (passe o mouse)</span>
      </div>
    </>
  );
}

function Coverage({ rows }: { rows: CoverageRow[] }) {
  const missing = rows.filter(r => r.best <= 1);
  return (
    <>
      <ul className="coverage">
        {rows.map(r => (
          <li key={r.type} className={r.best > 1 ? 'hit' : 'miss'} title={r.hitters.length ? `Super efetivo: ${r.hitters.join(', ')}` : 'Ninguém acerta super efetivo'}>
            <TypeBadge type={r.type} small />
            <span className={`mcell ${multClass(r.best)}`}>{formatMult(r.best)}×</span>
            <span className="small muted cov-hitters">{r.hitters.length ? r.hitters.join(', ') : '—'}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="small">
          <strong>Sem golpe super efetivo contra:</strong> {missing.map(r => TYPE_PT[r.type]).join(', ')}.
        </p>
      )}
    </>
  );
}

function RolesChecklist({ analysis }: { analysis: TeamAnalysis }) {
  const covered = analysis.roles.filter(r => r.providers.length > 0);
  const missingIds = new Set(analysis.missingRoles.map(r => r.id));
  return (
    <ul className="roles">
      {covered.map(r => (
        <li key={r.role.id} className="role ok" title={r.role.description}>
          <span className="role-mark" aria-label="coberto">✓</span>
          <div>
            <strong>{r.role.namePt}</strong>
            <p className="small muted">
              {r.providers.map(p => `${p.species}${p.via.length ? ` (${p.via.join(', ')})` : ''}`).join(' · ')}
            </p>
          </div>
        </li>
      ))}
      {analysis.missingRoles.map(r => (
        <li key={r.id} className="role missing" title={r.description}>
          <span className="role-mark" aria-label="faltando">✗</span>
          <div>
            <strong>{r.namePt}</strong>
            <p className="small muted">{r.description}</p>
          </div>
        </li>
      ))}
      {analysis.roles
        .filter(r => r.providers.length === 0 && !missingIds.has(r.role.id))
        .map(r => (
          <li key={r.role.id} className="role neutral" title={r.role.description}>
            <span className="role-mark" aria-hidden="true">·</span>
            <div>
              <strong>{r.role.namePt}</strong>
              <p className="small muted">opcional</p>
            </div>
          </li>
        ))}
    </ul>
  );
}

type SpeedMode = 'normal' | 'tailwind' | 'trickroom';

function SpeedTiers({ entries }: { entries: SpeedEntry[] }) {
  const { dex } = useApp();
  const [mode, setMode] = useState<SpeedMode>('normal');
  const rows = entries
    .map(e => ({ ...e, eff: !e.isMeta && mode === 'tailwind' ? effectiveSpeed(e.speed, { tailwind: true }) : e.speed }))
    .sort((a, b) => (mode === 'trickroom' ? a.eff - b.eff : b.eff - a.eff));
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Condição de velocidade">
        {(
          [
            ['normal', 'Normal'],
            ['tailwind', 'Com Tailwind'],
            ['trickroom', 'Trick Room'],
          ] as [SpeedMode, string][]
        ).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <p className="small muted">
        {mode === 'tailwind'
          ? 'Tailwind dobra a Velocidade da sua equipe por 4 turnos (contando o turno em que é usado).'
          : mode === 'trickroom'
            ? 'Trick Room inverte a ordem por 5 turnos: o mais lento age primeiro (prioridade continua valendo).'
            : 'Velocidade real no nível 50 com SP e natureza. Pokémon do meta usam o spread mais comum.'}
      </p>
      <ol className="speed-list">
        {rows.map((e, i) => {
          const sp = dex.species(e.species);
          return (
            <li key={`${e.species}-${e.slot ?? 'm'}-${i}`} className={e.isMeta ? 'meta' : 'mine'}>
              <span className="speed-val num">{e.eff}</span>
              <Sprite species={sp} name={e.species} size={28} />
              <span className="speed-name">
                {e.species}
                {!e.isMeta && <span className="tag tag-mine">sua equipe</span>}
              </span>
              <span className="small muted speed-label">
                {e.label}
                {e.usage ? ` · uso ${pct(e.usage)}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Threats({ analysis }: { analysis: TeamAnalysis }) {
  const { dex } = useApp();
  if (!analysis.threats.length) return <p className="muted">Sem dados de uso para listar ameaças do meta.</p>;
  return (
    <ul className="threats">
      {analysis.threats.map(t => {
        const sp = dex.species(t.species);
        return (
          <li key={t.species} className="threat">
            <div className="threat-head">
              <Sprite species={sp} name={t.species} size={40} />
              <div>
                <strong>{sp?.name ?? t.species}</strong>
                <span className="small muted"> · uso {pct(t.usage)}</span>
              </div>
              <span className={`danger ${t.danger >= 0.66 ? 'bad' : t.danger >= 0.33 ? 'warn' : 'good'}`}>{Math.round(t.danger * 100)}</span>
            </div>
            <ScoreBar value={t.danger} tone={t.danger >= 0.66 ? 'bad' : t.danger >= 0.33 ? 'warn' : 'good'} label={`Perigo ${Math.round(t.danger * 100)}`} />
            <Reasons items={t.reasonPt ? [t.reasonPt] : []} />
            <p className="small">
              <span className="ok-text">Respostas:</span> {t.answers.length ? t.answers.join(', ') : 'nenhuma'}
            </p>
            <p className="small">
              <span className="bad-text">Vulneráveis:</span> {t.victims.length ? t.victims.join(', ') : 'nenhum'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

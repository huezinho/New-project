/** Editor do set do slot selecionado: espécie, item, habilidade, natureza, SP e golpes. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { AbilitySuggestion, ItemSuggestion, MoveSuggestion, SpreadSuggestion } from '../../core/api.ts';
import { toId } from '../../core/id.ts';
import { CATEGORY_PT, NATURE_PT, pct, STAT_PT, STAT_SHORT, TYPE_PT } from '../../core/i18n.ts';
import { calcStats, emptySP, natureMultiplier, SP_MAX, SP_TOTAL, STAT_IDS, totalSP } from '../../core/stats.ts';
import type { PokemonSet, SpeciesData } from '../../core/types.ts';
import { Combobox, type ComboOption } from '../components/Combobox.tsx';
import { Card, EngineNotice, Notice, Reasons, ScoreBar } from '../components/common.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { TypeBadge, TypeList } from '../components/TypeBadge.tsx';
import { runAbilities, runBuildSet, runItems, runMoves, runSpreads, type Safe } from '../engineBridge.ts';
import { useApp } from '../state.tsx';
import {
  displayName, displayScore, illegalMoves, isMegaStone, itemsForSpecies, MAX_TEAM, repeatedMoves, sanitizeSP, setSPValue, spSummary,
} from '../util.ts';

const NO_SHARES: { id: string; name: string; share: number }[] = [];

export function SetEditor() {
  const { team, selected, activeTeam } = useApp();
  const set = team[selected];
  if (!set) return team.length < MAX_TEAM ? <AddMember /> : null;
  // remonta ao trocar de equipe salva (estado local do editor não vaza entre equipes)
  return <MemberEditor key={`${activeTeam.id}:${selected}`} slot={selected} set={set} />;
}

/** Opções de espécie ordenadas pelo uso no meta. */
function useSpeciesOptions(excludeSlot: number | null): ComboOption[] {
  const { dex, data, team } = useApp();
  const teamNums = useMemo(
    () => new Set(team.filter((_, i) => i !== excludeSlot).map(s => dex.species(s.species)?.num)),
    [dex, team, excludeSlot],
  );
  return useMemo(() => {
    const meta = data.meta.pokemon;
    return dex
      .selectableSpecies()
      .map(sp => ({ sp, usage: meta[sp.id]?.usage ?? 0 }))
      .sort((a, b) => b.usage - a.usage || a.sp.name.localeCompare(b.sp.name))
      .map(({ sp, usage }) => {
        const hasMega = (sp.megas ?? []).some(m => dex.isLegal(dex.species(m.id)));
        const inTeam = teamNums.has(sp.num);
        return {
          value: sp.name,
          label: sp.name,
          keywords: `${sp.types.map(t => `${t} ${TYPE_PT[t]}`).join(' ')}${hasMega ? ' mega' : ''}`,
          group: usage > 0 ? 'Mais usados no meta' : 'Todos os Pokémon',
          sub: `${inTeam ? 'já está na equipe · ' : ''}Vel. base ${sp.baseStats.spe}${hasMega ? ' · Mega disponível' : ''}`,
          hint: (
            <>
              <TypeList types={sp.types} small />
              {usage > 0 && <span className="usage">{pct(usage)}</span>}
            </>
          ),
          disabled: inTeam,
        } satisfies ComboOption;
      });
  }, [dex, data.meta, teamNums]);
}

function AddMember() {
  const { team, addSpecies } = useApp();
  const options = useSpeciesOptions(null);
  return (
    <Card title={`Adicionar Pokémon (${team.length + 1}/6)`} className="editor">
      <Combobox
        label="Espécie"
        value=""
        options={options}
        onChange={v => v && addSpecies(v)}
        placeholder="Digite o nome ou o tipo (ex.: Incineroar, Fada)…"
      />
      <p className="muted small">
        Ao escolher, o app monta um set recomendado para esta equipe (golpes, item, habilidade, natureza e SP). Veja também as
        sugestões para completar a equipe.
      </p>
    </Card>
  );
}

function MemberEditor({ slot, set }: { slot: number; set: PokemonSet }) {
  const { dex, bridge, team, updateSet, replaceSpecies, removeSet, engineTeam } = useApp();
  const species = dex.species(set.species);
  const form = dex.battleForm(set) ?? species;
  const ready = toId(engineTeam[slot]?.species) === toId(set.species) && !!species;
  const speciesOptions = useSpeciesOptions(slot);
  const megaCount = team.filter(s => isMegaStone(dex.item(s.item))).length;
  const [applied, setApplied] = useState<'ok' | 'fallback' | null>(null);
  useEffect(() => {
    if (!applied) return;
    const t = window.setTimeout(() => setApplied(null), 5000);
    return () => window.clearTimeout(t);
  }, [applied]);

  // set completo (golpes, item, habilidade, natureza e SP) montado para o resto da equipe
  const applyFullSet = () => {
    if (!species) return;
    const others = team.filter((_, i) => i !== slot);
    const { set: built, fromEngine } = runBuildSet(bridge, others, species.name);
    updateSet(slot, { item: built.item, ability: built.ability, nature: built.nature, sp: built.sp, moves: built.moves });
    setApplied(fromEngine ? 'ok' : 'fallback');
  };

  return (
    <Card
      className="editor"
      title={
        <span className="editor-title">
          <Sprite species={form} name={set.species} size={44} />
          <span>
            {set.species}
            {form?.isMega && <span className="tag tag-mega">{form.name}</span>}
          </span>
          <TypeList types={form?.types} small />
        </span>
      }
      actions={
        <>
          {species && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={applyFullSet}
              title="Troca golpes, item, habilidade, natureza e SP pelo set que o motor recomenda para esta equipe"
            >
              Aplicar set recomendado
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSet(slot)}>
            Remover
          </button>
        </>
      }
    >
      {applied && (
        <p className="small muted" aria-live="polite">
          {applied === 'ok'
            ? '✓ Set recomendado aplicado (golpes, item, habilidade, natureza e SP).'
            : 'Motor indisponível: aplicado o set mais usado no meta (ou um spread básico).'}
        </p>
      )}
      <div className="editor-grid">
        <Combobox
          label="Espécie"
          value={species?.name ?? set.species}
          options={speciesOptions}
          onChange={v => v && toId(v) !== toId(set.species) && replaceSpecies(slot, v)}
          placeholder="Trocar espécie…"
        />
        <ItemField slot={slot} set={set} species={species} />
        <AbilityField slot={slot} set={set} species={species} />
        <label className="field">
          <span className="field-label">Natureza</span>
          <select className="input" value={set.nature ?? ''} onChange={e => updateSet(slot, { nature: e.target.value || undefined })}>
            <option value="">— escolha —</option>
            {Object.values(dex.data.natures)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(n => (
                <option key={n.name} value={n.name}>
                  {NATURE_PT[n.name] ?? n.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {form?.isMega && (
        <Notice kind="info">
          Segurando {set.item}, vira <strong>{form.name}</strong> em batalha: tipos {form.types.map(t => TYPE_PT[t]).join('/')}, habilidade{' '}
          {dex.battleAbility(set)}. Lembre-se: só <strong>1 Mega Evolução por batalha</strong>
          {megaCount > 1 ? ` (a equipe tem ${megaCount} Mega Stones; escolha qual Mega usar no preview)` : ''}.
        </Notice>
      )}
      {species && !dex.isLegal(species) && <Notice kind="error">{species.name} não é legal na Reg {dex.regulation}.</Notice>}

      <SpEditor slot={slot} set={set} />
      {species && <MovesEditor slot={slot} set={set} species={species} ready={ready} />}
      {species && <SetSuggestions slot={slot} set={set} ready={ready} />}
    </Card>
  );
}

function ItemField({ slot, set, species }: { slot: number; set: PokemonSet; species: SpeciesData | undefined }) {
  const { dex, data, team, updateSet } = useApp();
  const usedBy = useMemo(() => {
    const m = new Map<string, string>();
    team.forEach((s, i) => i !== slot && s.item && m.set(toId(s.item), s.species));
    return m;
  }, [team, slot]);
  const options = useMemo(() => {
    const { megas, others } = itemsForSpecies(dex, species);
    const share = new Map((species ? data.meta.pokemon[species.id]?.items ?? [] : []).map(i => [toId(i.id), i.share]));
    const hint = (id: string) => {
      const owner = usedBy.get(id);
      if (owner) return <span className="tag tag-warn">em uso: {owner}</span>;
      const s = share.get(id);
      return s ? <span className="usage">{pct(s)}</span> : undefined;
    };
    const popular = others.filter(i => share.has(i.id)).sort((a, b) => share.get(b.id)! - share.get(a.id)!);
    const rest = others.filter(i => !share.has(i.id));
    const opts: ComboOption[] = [
      ...megas.map(i => {
        const mega = dex.species(i.megaStone![species!.name]);
        return {
          value: i.name, label: i.name, group: `Mega Stones de ${species!.name}`, title: i.shortDesc, hint: hint(i.id),
          sub: mega ? `${mega.name} · ${mega.types.map(t => TYPE_PT[t]).join('/')} · ${mega.abilities['0'] ?? ''}` : undefined,
          keywords: 'mega',
        };
      }),
      ...popular.map(i => ({ value: i.name, label: i.name, group: 'Mais usados nesta espécie', title: i.shortDesc, hint: hint(i.id) })),
      ...rest.map(i => ({ value: i.name, label: i.name, group: 'Todos os itens', title: i.shortDesc, hint: hint(i.id) })),
    ];
    // item atual inválido (ex.: importado) continua visível
    if (set.item && !opts.some(o => toId(o.value) === toId(set.item))) opts.unshift({ value: set.item, label: set.item, group: 'Atual', sub: 'indisponível para esta espécie/regulação' });
    return opts;
  }, [dex, data.meta, species, usedBy, set.item]);
  const item = dex.item(set.item);
  const owner = set.item ? usedBy.get(toId(set.item)) : undefined;
  return (
    <div className="field">
      <Combobox
        label="Item"
        value={item?.name ?? set.item ?? ''}
        options={options}
        onChange={v => updateSet(slot, { item: v || undefined })}
        placeholder="Sem item"
        clearable
      />
      {owner && <p className="field-error">Item Clause: {owner} já usa {set.item}. Itens não podem se repetir.</p>}
      {item && !owner && <p className="field-help">{item.shortDesc}</p>}
      {item && !item.legal[dex.regulation] && <p className="field-error">{item.name} não está disponível no Champions (Reg {dex.regulation}).</p>}
    </div>
  );
}

function AbilityField({ slot, set, species }: { slot: number; set: PokemonSet; species: SpeciesData | undefined }) {
  const { dex, data, updateSet } = useApp();
  const share = new Map((species ? data.meta.pokemon[species.id]?.abilities ?? [] : []).map(a => [toId(a.id), a.share]));
  const entries = species ? (Object.entries(species.abilities) as [string, string][]) : [];
  const known = entries.some(([, name]) => toId(name) === toId(set.ability));
  const battleAbility = dex.battleAbility(set);
  const form = dex.battleForm(set);
  const shown = dex.ability(form?.isMega ? battleAbility : set.ability);
  return (
    <label className="field">
      <span className="field-label">Habilidade</span>
      <select className="input" value={set.ability ?? ''} onChange={e => updateSet(slot, { ability: e.target.value || undefined })}>
        {!set.ability && <option value="">— escolha —</option>}
        {set.ability && !known && <option value={set.ability}>{set.ability} (inválida)</option>}
        {entries.map(([key, name]) => {
          const s = share.get(toId(name));
          return (
            <option key={key} value={name} title={dex.ability(name)?.shortDesc}>
              {name}
              {key === 'H' ? ' (oculta)' : key === 'S' ? ' (especial)' : ''}
              {s ? ` · ${pct(s)}` : ''}
            </option>
          );
        })}
      </select>
      {form?.isMega ? (
        <span className="field-help">
          Em batalha (Mega): <strong>{battleAbility}</strong>
          {shown ? ` — ${shown.shortDesc}` : ''}
        </span>
      ) : (
        shown && <span className="field-help">{shown.shortDesc}</span>
      )}
    </label>
  );
}

function SpEditor({ slot, set }: { slot: number; set: PokemonSet }) {
  const { dex, updateSet } = useApp();
  const form = dex.battleForm(set) ?? dex.species(set.species);
  const nature = set.nature ? dex.data.natures[toId(set.nature)] : undefined;
  const stats = form ? calcStats(form, set.sp, nature) : null;
  const used = totalSP(set.sp);
  const left = SP_TOTAL - used;
  const headingId = `sp-head-${slot}`;
  return (
    <section className="subsection" aria-labelledby={headingId}>
      <div className="section-head">
        <h3 id={headingId}>Stat Points (SP)</h3>
        <span className={`sp-left${left < 0 ? ' bad' : left === 0 ? ' ok' : ''}`} aria-live="polite">
          {used}/{SP_TOTAL} usados · restam {left}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => updateSet(slot, { sp: emptySP() })}>
          Zerar
        </button>
      </div>
      <p className="muted small">
        Máximo de {SP_MAX} por atributo e {SP_TOTAL} no total; cada SP soma +1 no atributo (nível 50).
        {form?.isMega ? ` Valores finais da forma em batalha: ${form.name}.` : ''}
      </p>
      <div className="sp-grid">
        <span className="sp-h">
          <span className="sp-long">Atributo</span>
          <span className="sp-short">Atr.</span>
        </span>
        <span className="sp-h num">Base</span>
        <span className="sp-h">SP</span>
        <span className="sp-h num" aria-hidden="true" />
        <span className="sp-h num">Final</span>
        {STAT_IDS.map(s => {
          const v = set.sp[s] ?? 0;
          const mult = natureMultiplier(nature, s);
          const cls = mult > 1 ? 'plus' : mult < 1 ? 'minus' : '';
          const max = Math.min(SP_MAX, v + Math.max(0, left));
          return (
            <div className="sp-row" key={s}>
              <span className={`sp-name ${cls}`} title={STAT_PT[s]}>
                <span className="sp-long">{STAT_PT[s]}</span>
                <span className="sp-short">{STAT_SHORT[s]}</span>
                {cls && <span aria-label={mult > 1 ? 'natureza aumenta' : 'natureza diminui'}>{mult > 1 ? ' +' : ' −'}</span>}
              </span>
              <span className="num muted">{form?.baseStats[s] ?? '—'}</span>
              <input
                type="range"
                min={0}
                max={SP_MAX}
                step={1}
                value={v}
                aria-label={`SP em ${STAT_PT[s]}`}
                style={{ '--fill': `${(v / SP_MAX) * 100}%`, '--cap': `${(max / SP_MAX) * 100}%` } as CSSProperties}
                onChange={e => updateSet(slot, { sp: setSPValue(set.sp, s, Number(e.target.value)) })}
              />
              <input
                type="number"
                className="input sp-num"
                min={0}
                max={SP_MAX}
                value={v}
                aria-label={`SP em ${STAT_PT[s]} (número)`}
                onChange={e => updateSet(slot, { sp: setSPValue(set.sp, s, Number(e.target.value)) })}
              />
              <span className={`num sp-final ${cls}`}>{stats ? stats[s] : '—'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MovesEditor({ slot, set, species, ready }: { slot: number; set: PokemonSet; species: SpeciesData; ready: boolean }) {
  const { dex, data, bridge, engineTeam, engineKey, updateSet } = useApp();
  const res = ready ? runMoves(bridge, engineTeam, engineKey, slot) : null;
  const sugg = res?.ok ? res.value : null;
  const metaMoves = data.meta.pokemon[species.id]?.moves ?? NO_SHARES;

  const options = useMemo(() => {
    const rank = new Map<string, MoveSuggestion>((sugg?.ranked ?? []).map(r => [toId(r.move), r]));
    const usage = new Map(metaMoves.map(m => [toId(m.id), m.share]));
    const list = dex.learnset(species);
    const sorted = [...list].sort((a, b) => {
      const ra = rank.get(a.id)?.score ?? -1;
      const rb = rank.get(b.id)?.score ?? -1;
      if (ra !== rb) return rb - ra;
      const ua = usage.get(a.id) ?? 0;
      const ub = usage.get(b.id) ?? 0;
      if (ua !== ub) return ub - ua;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(m => {
      const r = rank.get(m.id);
      const u = r?.usage ?? usage.get(m.id) ?? 0;
      const acc = m.accuracy === true ? '—' : `${m.accuracy}%`;
      const title = [...(r?.reasonsPt ?? []), m.shortDesc].filter(Boolean).join('\n');
      return {
        value: m.name,
        label: m.name,
        group: r ? 'Sugeridos para sua equipe' : u > 0 ? 'Usados no meta' : 'Todos os golpes',
        keywords: `${m.type} ${TYPE_PT[m.type]} ${CATEGORY_PT[m.category]} ${(r?.tags ?? []).join(' ')}`,
        sub: `${CATEGORY_PT[m.category]}${m.basePower ? ` · Poder ${m.basePower}` : ''} · Prec. ${acc}${m.priority ? ` · Prioridade ${m.priority > 0 ? '+' : ''}${m.priority}` : ''}`,
        title,
        hint: (
          <>
            <TypeBadge type={m.type} small />
            {r && <span className="score-chip" title="Nota para esta equipe">★ {displayScore(r.score)}</span>}
            {u > 0 && <span className="usage">{pct(u, 0)}</span>}
          </>
        ),
      } satisfies ComboOption;
    });
  }, [dex, species, sugg, metaMoves]);

  const chosen = set.moves.map(m => toId(m));
  const badMoves = illegalMoves(dex, set);
  const repeated = repeatedMoves(dex, set);
  const setMove = (i: number, value: string) => {
    const moves = [...set.moves];
    if (value) moves[i] = value;
    else moves.splice(i, 1);
    updateSet(slot, { moves: moves.filter(Boolean).slice(0, 4) });
  };
  const apply = (names: string[]) => {
    const seen = new Set<string>();
    const moves = names
      .map(n => displayName(dex, 'move', n))
      .filter(n => {
        const id = toId(n);
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, 4);
    if (moves.length) updateSet(slot, { moves });
  };
  const mostUsedFallback = metaMoves.filter(m => dex.canLearn(species, m.id)).slice(0, 4).map(m => m.name);
  const recommended = sugg?.recommended ?? [];
  const mostUsed = sugg?.mostUsed?.length ? sugg.mostUsed : mostUsedFallback;
  const sameAs = (list: string[]) => list.length > 0 && list.map(toId).sort().join() === [...chosen].sort().join();
  const headingId = `moves-head-${slot}`;

  return (
    <section className="subsection" aria-labelledby={headingId}>
      <div className="section-head">
        <h3 id={headingId}>Golpes</h3>
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-sm" disabled={!recommended.length || sameAs(recommended)} onClick={() => apply(recommended)}>
            Aplicar golpes recomendados
          </button>
          <button type="button" className="btn btn-sm" disabled={!mostUsed.length || sameAs(mostUsed)} onClick={() => apply(mostUsed)}>
            Aplicar golpes mais usados
          </button>
        </div>
      </div>
      <div className="moves-grid">
        {[0, 1, 2, 3].map(i => {
          const current = set.moves[i] ?? '';
          const opts = options.map(o => (chosen.includes(toId(o.value)) && toId(o.value) !== toId(current) ? { ...o, disabled: true } : o));
          return (
            <Combobox
              key={i}
              label={`Golpe ${i + 1}`}
              value={dex.move(current)?.name ?? current}
              options={opts}
              onChange={v => setMove(i, v)}
              placeholder={i < set.moves.length ? 'Buscar golpe…' : 'Escolher golpe…'}
              clearable
              maxResults={120}
            />
          );
        })}
      </div>
      {badMoves.length > 0 && (
        <p className="field-error">
          {species.name} não aprende {badMoves.join(', ')} no Champions — troque {badMoves.length > 1 ? 'esses golpes' : 'esse golpe'}.
        </p>
      )}
      {repeated.length > 0 && <p className="field-error">Golpe repetido: {repeated.join(', ')}.</p>}
      {!ready && <p className="muted small">Atualizando sugestões…</p>}
      {res && <EngineNotice result={res} what="Ranking de golpes" fallback="Os golpes aparecem ordenados pelo uso no meta (quando houver dados)." />}
      {sugg && (recommended.length > 0 || mostUsed.length > 0) && (
        <div className="compare">
          <div>
            <h4>Recomendado para sua equipe</h4>
            <MoveList names={recommended} other={mostUsed} />
          </div>
          <div>
            <h4>Mais usado no meta</h4>
            <MoveList names={mostUsed} other={recommended} />
          </div>
        </div>
      )}
      {sugg && sugg.diffPt.length > 0 && (
        <div className="why">
          <h4>Por que mudar?</h4>
          <ul>
            {sugg.diffPt.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MoveList({ names, other }: { names: string[]; other: string[] }) {
  const { dex } = useApp();
  if (!names.length) return <p className="muted small">Sem dados.</p>;
  const otherIds = new Set(other.map(toId));
  return (
    <ul className="move-list">
      {names.map(n => {
        const m = dex.move(n);
        const diff = !otherIds.has(toId(n));
        return (
          <li key={n} className={diff ? 'diff' : ''} title={m?.shortDesc}>
            {m && <TypeBadge type={m.type} small />} {m?.name ?? n}
            {diff && <span className="tag">diferente</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Sugestões de reserva a partir do uso no meta (quando o motor não responde). */
function useMetaFallback(slot: number, set: PokemonSet) {
  const { dex, data, team } = useApp();
  return useMemo(() => {
    const species = dex.species(set.species);
    const mp = species ? data.meta.pokemon[species.id] : undefined;
    if (!species || !mp) return { items: [] as ItemSuggestion[], abilities: [] as AbilitySuggestion[], spreads: [] as SpreadSuggestion[] };
    const used = new Set(team.filter((_, i) => i !== slot).map(s => toId(s.item)).filter(Boolean));
    const items: ItemSuggestion[] = mp.items
      .map(i => ({ i, item: dex.item(i.id) }))
      .filter(({ item }) => item && item.legal[dex.regulation] && (!isMegaStone(item) || !!item.megaStone![species.name]))
      .slice(0, 6)
      .map(({ i, item }) => ({
        item: item!.name, score: i.share, usage: i.share, blocked: used.has(item!.id),
        reasonsPt: [`Usado por ${pct(i.share)} dos ${species.name} no meta.`],
      }));
    const legalAbilities = new Set(Object.values(species.abilities).map(toId));
    const abilities: AbilitySuggestion[] = mp.abilities
      .filter(a => legalAbilities.has(toId(a.id)))
      .slice(0, 4)
      .map(a => ({ ability: dex.ability(a.id)?.name ?? a.name, score: a.share, usage: a.share, reasonsPt: [`Escolhida por ${pct(a.share)} no meta.`] }));
    const spreads: SpreadSuggestion[] = mp.spreads.slice(0, 4).map((sp, k) => {
      const nature = dex.data.natures[toId(sp.nature)];
      const clean = sanitizeSP(sp.sp);
      const form = dex.battleForm(set) ?? species;
      return {
        id: `meta-${k}`, labelPt: k === 0 ? 'Mais usado' : `${k + 1}º mais usado`, nature: nature?.name ?? sp.nature, sp: clean,
        stats: calcStats(form, clean, nature), usage: sp.share, reasonsPt: [],
      };
    });
    return { items, abilities, spreads };
  }, [dex, data.meta, team, slot, set]);
}

function SetSuggestions({ slot, set, ready }: { slot: number; set: PokemonSet; ready: boolean }) {
  const { dex, bridge, engineTeam, engineKey, updateSet } = useApp();
  const fb = useMetaFallback(slot, set);
  if (!ready) return <p className="muted small">Atualizando sugestões de item, habilidade e spread…</p>;
  const itemsRes = runItems(bridge, engineTeam, engineKey, slot);
  const abilitiesRes = runAbilities(bridge, engineTeam, engineKey, slot);
  const spreadsRes = runSpreads(bridge, engineTeam, engineKey, slot);
  const items = itemsRes.ok ? itemsRes.value : fb.items;
  const abilities = abilitiesRes.ok ? abilitiesRes.value : fb.abilities;
  const spreads = spreadsRes.ok ? spreadsRes.value : fb.spreads;
  const allFailed = !itemsRes.ok && !abilitiesRes.ok && !spreadsRes.ok;
  const hasFallback = fb.items.length + fb.abilities.length + fb.spreads.length > 0;
  const note = (res: Safe<unknown>, list: unknown[]) =>
    res.ok ? null : list.length ? <p className="small muted">Pelo uso no meta (motor indisponível).</p> : <p className="small muted">Sem sugestões no momento.</p>;
  if (allFailed && !hasFallback) {
    return (
      <section className="subsection" aria-label="Sugestões para este Pokémon">
        <EngineNotice
          result={itemsRes}
          what="Sugestões de item, habilidade e spread"
          fallback="Elas aparecem aqui quando o motor responder ou quando houver dados de uso desta espécie."
        />
      </section>
    );
  }
  return (
    <section className="subsection" aria-label="Sugestões para este Pokémon">
      {allFailed && (
        <EngineNotice result={itemsRes} what="Sugestões do motor" fallback="Mostrando os itens, habilidades e spreads mais usados no meta." />
      )}
      <div className="sugg-cols">
        <div>
          <h3>Itens sugeridos</h3>
          {!allFailed && note(itemsRes, items)}
          <ul className="pick-list">
            {items.slice(0, 6).map(it => {
              const name = displayName(dex, 'item', it.item);
              const current = toId(name) === toId(set.item);
              return (
                <li key={it.item} className={it.blocked ? 'blocked' : ''}>
                  <div className="pick-head">
                    <strong>{name}</strong>
                    {itemsRes.ok && <span className="score-chip">★ {displayScore(it.score)}</span>}
                    {it.usage > 0 && <span className="usage">{pct(it.usage)}</span>}
                  </div>
                  <ScoreBar value={itemsRes.ok ? displayScore(it.score) / 100 : it.usage} tone={it.blocked ? 'muted' : 'accent'} />
                  <Reasons items={it.reasonsPt} max={2} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={current || it.blocked}
                    title={it.blocked ? 'Já usado por outro membro (Item Clause)' : undefined}
                    onClick={() => updateSet(slot, { item: name })}
                  >
                    {current ? 'Em uso' : it.blocked ? 'Bloqueado (Item Clause)' : 'Aplicar'}
                  </button>
                </li>
              );
            })}
            {itemsRes.ok && items.length === 0 && <li className="muted small">Sem sugestões.</li>}
          </ul>
        </div>
        <div>
          <h3>Habilidades</h3>
          {!allFailed && note(abilitiesRes, abilities)}
          <ul className="pick-list">
            {abilities.slice(0, 4).map(ab => {
              const name = displayName(dex, 'ability', ab.ability);
              const current = toId(name) === toId(set.ability);
              return (
                <li key={ab.ability}>
                  <div className="pick-head">
                    <strong>{name}</strong>
                    {abilitiesRes.ok && <span className="score-chip">★ {displayScore(ab.score)}</span>}
                    {ab.usage > 0 && <span className="usage">{pct(ab.usage)}</span>}
                  </div>
                  <ScoreBar value={abilitiesRes.ok ? displayScore(ab.score) / 100 : ab.usage} />
                  <Reasons items={ab.reasonsPt} max={2} />
                  <button type="button" className="btn btn-sm" disabled={current} onClick={() => updateSet(slot, { ability: name })}>
                    {current ? 'Em uso' : 'Aplicar'}
                  </button>
                </li>
              );
            })}
            {abilitiesRes.ok && abilities.length === 0 && <li className="muted small">Sem sugestões.</li>}
          </ul>
        </div>
        <div>
          <h3>Spreads de SP</h3>
          {!allFailed && note(spreadsRes, spreads)}
          <ul className="pick-list">
            {spreads.slice(0, 4).map(sp => {
              const clean = sanitizeSP(sp.sp);
              const current = toId(sp.nature) === toId(set.nature) && STAT_IDS.every(s => clean[s] === (set.sp[s] ?? 0));
              return (
                <li key={sp.id}>
                  <div className="pick-head">
                    <strong>{sp.labelPt}</strong>
                    {sp.usage ? <span className="usage">{pct(sp.usage)}</span> : null}
                  </div>
                  <p className="small">
                    {NATURE_PT[displayName(dex, 'nature', sp.nature)] ?? sp.nature} · {spSummary(clean)}
                  </p>
                  {sp.stats && (
                    <p className="small muted stat-line">
                      {STAT_IDS.map(s => `${STAT_SHORT[s]} ${sp.stats[s]}`).join(' · ')}
                    </p>
                  )}
                  <Reasons items={sp.reasonsPt} max={2} />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={current}
                    onClick={() => updateSet(slot, { nature: displayName(dex, 'nature', sp.nature), sp: clean })}
                  >
                    {current ? 'Em uso' : 'Aplicar'}
                  </button>
                </li>
              );
            })}
            {spreadsRes.ok && spreads.length === 0 && <li className="muted small">Sem sugestões.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
}

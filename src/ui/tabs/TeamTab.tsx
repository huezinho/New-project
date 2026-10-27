/** Aba "Equipe": equipes salvas, 6 slots, editor de set e painel de sugestões. */
import { useState } from 'react';
import { TYPE_COLORS } from '../../core/i18n.ts';
import { toId } from '../../core/id.ts';
import type { PokemonSet } from '../../core/types.ts';
import { Notice } from '../components/common.tsx';
import { Sprite } from '../components/Sprite.tsx';
import { TypeList } from '../components/TypeBadge.tsx';
import { useApp } from '../state.tsx';
import { isMegaStone, itemClauseConflicts, MAX_TEAM, megaStoneCount, speciesClauseConflicts } from '../util.ts';
import { SetEditor } from './SetEditor.tsx';
import { SuggestionsPanel } from './SuggestionsPanel.tsx';

export function TeamTab() {
  const { data, regulation } = useApp();
  return (
    <div className="team-layout">
      <div className="team-main">
        {data.meta.regulation && data.meta.regulation !== regulation && (
          <Notice kind="info">
            Os dados de uso são da Reg {data.meta.regulation}; a legalidade e as sugestões seguem a Reg {regulation}.
          </Notice>
        )}
        <TeamBar />
        <TeamSlots />
        <SetEditor />
      </div>
      <aside className="team-side" aria-label="Sugestões">
        <SuggestionsPanel />
      </aside>
    </div>
  );
}

function TeamBar() {
  const { store, activeTeam, switchTeam, createTeam, duplicateTeam, deleteTeam, renameTeam } = useApp();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="team-bar">
      <label className="field team-name">
        <span className="field-label">Nome da equipe</span>
        <input className="input" value={activeTeam.name} maxLength={60} onChange={e => renameTeam(e.target.value)} />
      </label>
      {store.teams.length > 1 && (
        <label className="field">
          <span className="field-label">Equipes salvas</span>
          <select className="input" value={activeTeam.id} onChange={e => switchTeam(e.target.value)}>
            {store.teams.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.team.length}/6)
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="team-bar-actions">
        <button type="button" className="btn" onClick={() => createTeam()}>
          Nova
        </button>
        <button type="button" className="btn" onClick={duplicateTeam}>
          Duplicar
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                deleteTeam();
                setConfirming(false);
              }}
            >
              Confirmar exclusão
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
            Excluir
          </button>
        )}
      </div>
    </div>
  );
}

function TeamSlots() {
  const { team, dex, selected, setSelected, removeSet } = useApp();
  const itemConflicts = itemClauseConflicts(team);
  const speciesConflicts = speciesClauseConflicts(dex, team);
  const megas = megaStoneCount(dex, team);
  return (
    <section aria-label="Membros da equipe">
      <div className="slots">
        {Array.from({ length: MAX_TEAM }, (_, i) => {
          const set = team[i];
          if (!set) {
            const isNext = i === team.length;
            return (
              <button
                key={`empty-${i}`}
                type="button"
                className={`slot slot-empty${isNext && selected === i ? ' selected' : ''}${isNext ? ' next' : ''}`}
                onClick={() => setSelected(team.length)}
                aria-label={`Adicionar Pokémon (slot ${i + 1})`}
              >
                <span className="slot-plus" aria-hidden="true">+</span>
                <span>{isNext ? 'Adicionar Pokémon' : `Slot ${i + 1}`}</span>
              </button>
            );
          }
          const warnings: string[] = [];
          if (itemConflicts.has(i)) warnings.push(`Item repetido (Item Clause) com ${itemConflicts.get(i)!.map(j => team[j].species).join(', ')}`);
          if (speciesConflicts.has(i)) warnings.push('Espécie repetida (Species Clause)');
          const species = dex.species(set.species);
          if (species && !dex.isLegal(species)) warnings.push(`Ilegal na Reg ${dex.regulation}`);
          if (!species) warnings.push('Espécie desconhecida');
          if (set.moves.filter(Boolean).length < 4) warnings.push(`${set.moves.filter(Boolean).length}/4 golpes`);
          return (
            <SlotCard
              key={`${i}-${toId(set.species)}`}
              set={set}
              index={i}
              selected={selected === i}
              warnings={warnings}
              onSelect={() => setSelected(i)}
              onRemove={() => removeSet(i)}
            />
          );
        })}
      </div>
      {megas > 2 && (
        <Notice kind="warn">
          A equipe carrega {megas} Mega Stones. Só é possível Mega Evoluir <strong>uma vez por batalha</strong>; mais de 2 costuma ser
          desperdício de slot de item.
        </Notice>
      )}
    </section>
  );
}

function SlotCard({ set, index, selected, warnings, onSelect, onRemove }: {
  set: PokemonSet; index: number; selected: boolean; warnings: string[]; onSelect: () => void; onRemove: () => void;
}) {
  const { dex } = useApp();
  const form = dex.battleForm(set);
  const base = dex.species(set.species);
  const isMega = !!form?.isMega;
  const ability = dex.battleAbility(set);
  const item = dex.item(set.item);
  const severe = warnings.some(w => /Clause|Ilegal|desconhecida/.test(w));
  return (
    <div className={`slot${selected ? ' selected' : ''}${severe ? ' has-error' : ''}`}>
      <button type="button" className="slot-main" onClick={onSelect} aria-pressed={selected} aria-label={`Editar ${set.species} (slot ${index + 1})`}>
        <span className="slot-top">
          <Sprite species={form ?? base} name={set.species} size={56} />
          <span className="slot-id">
            <span className="slot-name">
              {set.nickname || set.species}
              {isMega && <span className="tag tag-mega" title={`Em batalha: ${form!.name}`}>Mega</span>}
            </span>
            <TypeList types={(form ?? base)?.types} small />
          </span>
        </span>
        <span className="slot-line" title={item?.shortDesc}>
          <span className="muted">Item:</span> {set.item ? set.item : <em className="muted">nenhum</em>}
          {isMegaStone(item) && !isMega && <span className="tag tag-warn">não serve</span>}
        </span>
        <span className="slot-line">
          <span className="muted">Hab.:</span> {ability ?? <em className="muted">—</em>}
        </span>
        <span className="slot-moves">
          {set.moves.filter(Boolean).map(m => {
            const mv = dex.move(m);
            return (
              <span key={m} className="move-chip" style={mv ? { borderLeftColor: TYPE_COLORS[mv.type] } : undefined}>
                {mv?.name ?? m}
              </span>
            );
          })}
        </span>
        {warnings.length > 0 && (
          <span className={`slot-warn${severe ? ' bad' : ''}`}>
            {warnings.map(w => (
              <span key={w}>⚠ {w}</span>
            ))}
          </span>
        )}
      </button>
      <button type="button" className="slot-remove" onClick={onRemove} aria-label={`Remover ${set.species}`} title="Remover">
        ×
      </button>
    </div>
  );
}

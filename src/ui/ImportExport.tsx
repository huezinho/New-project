/** Modal de importação/exportação no formato de texto do Pokémon Showdown. */
import { useMemo, useRef, useState } from 'react';
import { exportTeam, parseTeam } from '../core/paste.ts';
import { Modal, Notice } from './components/common.tsx';
import { useApp } from './state.tsx';
import { normalizeSet } from './util.ts';

const EXAMPLE = `Incineroar @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 2 Def / 32 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- Knock Off`;

export function ImportExportModal({ onClose, initialMode = 'import' }: { onClose: () => void; initialMode?: 'import' | 'export' }) {
  const { dex, team, setTeam, createTeam, activeTeam, goTab } = useApp();
  const [mode, setMode] = useState<'import' | 'export'>(team.length ? initialMode : 'import');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const exportRef = useRef<HTMLTextAreaElement>(null);
  const exported = useMemo(() => (team.length ? exportTeam(team) : ''), [team]);

  const parsed = useMemo(() => {
    if (!text.trim()) return { sets: [], warnings: [] as string[] };
    const sets = parseTeam(text);
    const warnings: string[] = [];
    const out = sets.map(s => {
      const r = normalizeSet(dex, s);
      warnings.push(...r.warnings);
      return r.set;
    });
    return { sets: out, warnings };
  }, [text, dex]);

  const doImport = (asNew: boolean) => {
    if (!parsed.sets.length) return;
    if (asNew) createTeam('Equipe importada', parsed.sets);
    else setTeam(parsed.sets);
    goTab('equipe');
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setCopied('ok');
    } catch {
      // reserva: seleciona o texto para Ctrl+C
      exportRef.current?.select();
      try {
        setCopied(document.execCommand('copy') ? 'ok' : 'fail');
      } catch {
        setCopied('fail');
      }
    }
  };

  const download = () => {
    try {
      const blob = new Blob([exported], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeTeam.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'equipe'}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setCopied('fail');
    }
  };

  return (
    <Modal title="Importar / Exportar equipe" onClose={onClose}>
      <div className="segmented" role="tablist" aria-label="Modo">
        <button type="button" role="tab" aria-selected={mode === 'import'} className={mode === 'import' ? 'on' : ''} onClick={() => setMode('import')}>
          Importar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'export'}
          className={mode === 'export' ? 'on' : ''}
          onClick={() => setMode('export')}
          disabled={!team.length}
        >
          Exportar
        </button>
      </div>
      {mode === 'import' ? (
        <div className="ie">
          <label className="field">
            <span className="field-label">Cole a equipe no formato do Showdown</span>
            <textarea
              className="input mono"
              rows={12}
              value={text}
              placeholder={EXAMPLE}
              onChange={e => setText(e.target.value)}
              spellCheck={false}
            />
          </label>
          <p className="small muted">
            EVs de Scarlet/Violet (ex.: 252/4/252) são convertidos automaticamente para Stat Points (66 no total, máx. 32 por atributo). Tera
            Type e IVs são ignorados — não existem no Champions.
          </p>
          {parsed.sets.length > 0 && (
            <Notice kind="ok">
              {parsed.sets.length} Pokémon reconhecido{parsed.sets.length > 1 ? 's' : ''}: {parsed.sets.map(s => s.species).join(', ')}
            </Notice>
          )}
          {parsed.warnings.length > 0 && (
            <Notice kind="warn" title="Avisos">
              <ul className="small">
                {parsed.warnings.slice(0, 12).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {parsed.warnings.length > 12 && <li>… e mais {parsed.warnings.length - 12}.</li>}
              </ul>
            </Notice>
          )}
          {text.trim() && parsed.sets.length === 0 && <Notice kind="error">Não encontrei nenhum Pokémon nesse texto.</Notice>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={!parsed.sets.length} onClick={() => doImport(true)}>
              Importar como nova equipe
            </button>
            <button type="button" className="btn" disabled={!parsed.sets.length} onClick={() => doImport(false)}>
              Substituir equipe atual
            </button>
          </div>
        </div>
      ) : (
        <div className="ie">
          <label className="field">
            <span className="field-label">Equipe "{activeTeam.name}" (SP na linha EVs, como no Showdown do Champions)</span>
            <textarea ref={exportRef} className="input mono" rows={14} value={exported} readOnly onFocus={e => e.currentTarget.select()} />
          </label>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={copy}>
              Copiar
            </button>
            <button type="button" className="btn" onClick={download}>
              Baixar .txt
            </button>
            <span className="small" aria-live="polite">
              {copied === 'ok' ? '✓ Copiado!' : copied === 'fail' ? 'Não foi possível copiar; selecione e copie manualmente.' : ''}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

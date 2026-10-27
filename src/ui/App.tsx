/** Casca do app: carregamento dos dados, cabeçalho, abas e rodapé. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DataLoadError, loadAppData, type AppData } from './data.ts';
import { useHashTab } from './hooks.ts';
import { ImportExportModal } from './ImportExport.tsx';
import { AppProvider, TABS, useApp, type TabId } from './state.tsx';
import { AnalysisTab } from './tabs/AnalysisTab.tsx';
import { MetaTab } from './tabs/MetaTab.tsx';
import { RulesTab } from './tabs/RulesTab.tsx';
import { SourcesTab } from './tabs/SourcesTab.tsx';
import { TeamTab } from './tabs/TeamTab.tsx';
import { ageInDays, formatDate, relativeAge } from './util.ts';

type LoadState = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: AppData };

const TAB_LABEL: Record<TabId, string> = {
  equipe: 'Equipe',
  analise: 'Análise',
  meta: 'Meta',
  regras: 'Regras e atualizações',
  fontes: 'Fontes de dados',
};

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [tab, goTab] = useHashTab(TABS, 'equipe');
  const load = useCallback(() => {
    setState({ status: 'loading' });
    loadAppData()
      .then(data => setState({ status: 'ready', data }))
      .catch(error => setState({ status: 'error', error }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className="center-screen" role="status" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p>Carregando banco de dados do Pokémon Champions…</p>
      </div>
    );
  }
  if (state.status === 'error') {
    const failed = state.error instanceof DataLoadError ? state.error.failed : [];
    return (
      <div className="center-screen">
        <div className="card error-card" role="alert">
          <h1>Não foi possível carregar os dados</h1>
          <p>O app precisa dos arquivos de dados em <code>public/data/</code> para funcionar.</p>
          {failed.length > 0 ? (
            <ul>
              {failed.map(f => (
                <li key={f.file}>
                  <code>{f.file}</code>: {f.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{state.error instanceof Error ? state.error.message : String(state.error)}</p>
          )}
          <p className="small">
            Se você está rodando localmente, gere os dados com <code>npm run update-data</code> e recarregue a página.
          </p>
          <button type="button" className="btn btn-primary" onClick={load}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
  return (
    <AppProvider data={state.data} tab={tab} goTab={goTab}>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { tab, goTab } = useApp();
  const [modal, setModal] = useState<null | 'import' | 'export'>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = TABS.indexOf(tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    goTab(TABS[next]);
    tabRefs.current[TABS[next]]?.focus();
  };
  useEffect(() => {
    document.title = `${TAB_LABEL[tab]} · Champions VGC Builder`;
  }, [tab]);

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <Header onImport={() => setModal('import')} onExport={() => setModal('export')} />
      <nav className="tabs" aria-label="Seções">
        <div className="tabs-inner" role="tablist" aria-label="Seções do app" onKeyDown={onTabKey}>
          {TABS.map(t => (
            <button
              key={t}
              ref={el => {
                tabRefs.current[t] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls="conteudo"
              tabIndex={tab === t ? 0 : -1}
              className={`tab${tab === t ? ' on' : ''}`}
              onClick={() => goTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </nav>
      <main id="conteudo" className="content" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {tab === 'equipe' && <TeamTab />}
        {tab === 'analise' && <AnalysisTab />}
        {tab === 'meta' && <MetaTab />}
        {tab === 'regras' && <RulesTab />}
        {tab === 'fontes' && <SourcesTab />}
      </main>
      <footer className="footer">
        <p>
          Dados do jogo: mod <code>champions</code> do Pokémon Showdown. Uso e resultados: Smogon, Limitless e replays públicos. Projeto de fãs sem
          afiliação com Nintendo, Game Freak ou The Pokémon Company.
        </p>
      </footer>
      {modal && <ImportExportModal initialMode={modal} onClose={() => setModal(null)} />}
    </div>
  );
}

function Header({ onImport, onExport }: { onImport: () => void; onExport: () => void }) {
  const { data, regulation, setRegulation, team } = useApp();
  const { dex, meta } = data;
  const format = dex.formats.find(f => f.regulation === regulation);
  const isCurrent = format ? format.current : regulation === dex.currentRegulation;
  const metaAge = ageInDays(meta.generatedAt);
  const stale = metaAge !== null && metaAge > 14;
  return (
    <header className="app-header">
      <div className="brand">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={36} height={36} />
        <div>
          <h1>Champions VGC Builder</h1>
          <p className="tagline">Montador de equipes VGC · Pokémon Champions</p>
        </div>
      </div>
      <div className="header-meta">
        <span className={`badge badge-reg${isCurrent ? '' : ' old'}`} title={format?.name}>
          Reg {regulation} · {isCurrent ? 'atual' : 'anterior'}
        </span>
        <span className={`fresh small${stale ? ' stale' : ''}`} title={`Dex: ${dex.generatedAt}\nMeta: ${meta.generatedAt}`}>
          Dex {formatDate(dex.generatedAt)} · Meta {formatDate(meta.generatedAt)}
          {meta.generatedAt ? ` (${relativeAge(meta.generatedAt)})` : ''}
          {stale ? ' · dados antigos' : ''}
        </span>
        {dex.formats.length > 1 && (
          <label className="reg-select">
            <span className="sr-only">Regulação</span>
            <select className="input input-sm" value={regulation} onChange={e => setRegulation(e.target.value)} aria-label="Regulação">
              {dex.formats.map(f => (
                <option key={f.id} value={f.regulation}>
                  Reg {f.regulation}
                  {f.current ? ' (atual)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={onImport}>
            Importar
          </button>
          <button type="button" className="btn btn-sm" onClick={onExport} disabled={!team.length}>
            Exportar
          </button>
        </div>
      </div>
    </header>
  );
}

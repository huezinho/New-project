/** Componentes pequenos e reutilizáveis (barras, avisos, modal). */
import { Component, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Safe } from '../engineBridge.ts';
import { clamp01 } from '../util.ts';

export function ScoreBar({ value, label, tone = 'accent' }: { value: number; label?: string; tone?: 'accent' | 'good' | 'warn' | 'bad' | 'muted' }) {
  const v = clamp01(value);
  return (
    <span className={`bar bar-${tone}`} role="img" aria-label={label ?? `${Math.round(v * 100)}%`}>
      <span style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export function Notice({ kind = 'info', children, title }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; title?: string }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong className="notice-title">{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

/** Aviso padrão quando uma função do motor falha. */
export function EngineNotice({ result, what, fallback }: { result: Safe<unknown>; what: string; fallback?: string }) {
  if (result.ok) return null;
  return (
    <Notice kind="warn" title={`${what} indisponível`}>
      <p className="small">
        O motor de sugestões não respondeu (<code>{result.error}</code>).{' '}
        {fallback ?? 'O restante do app continua funcionando normalmente.'}
      </p>
    </Notice>
  );
}

export function EmptyState({ title, children, icon = '◌' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('textarea, input, select, button:not(.modal-close)');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      } else if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          el => !el.hasAttribute('disabled'),
        );
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-ghost modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Lista de motivos com limite e "ver mais". */
export function Reasons({ items, max = 3 }: { items: string[] | undefined; max?: number }) {
  if (!items?.length) return null;
  const head = items.slice(0, max);
  const rest = items.slice(max);
  return (
    <div className="reasons">
      <ul>
        {head.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      {rest.length > 0 && (
        <details>
          <summary>+{rest.length} motivo{rest.length > 1 ? 's' : ''}</summary>
          <ul>
            {rest.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Isola falhas de renderização: uma aba com dados inesperados não derruba o app inteiro. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; what?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    // trocar de aba (ou de equipe) tenta renderizar de novo
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice notice-error" role="alert">
        <strong className="notice-title">{this.props.what ?? 'Esta seção'} não pôde ser exibida</strong>
        <div>
          <p className="small">
            Algum dado veio num formato inesperado (<code>{this.state.error.message}</code>). O restante do app continua funcionando; rodar{' '}
            <code>npm run update-data</code> costuma resolver.
          </p>
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
}

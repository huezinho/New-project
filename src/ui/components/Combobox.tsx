/**
 * Campo de busca com lista de opções (padrão ARIA combobox): filtra ao
 * digitar, navega com ↑/↓, escolhe com Enter e fecha com Esc.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { matchesQuery } from '../util.ts';

export interface ComboOption {
  value: string;
  label: string;
  keywords?: string;
  group?: string;
  /** Conteúdo à direita (tipo, uso, nota...). */
  hint?: ReactNode;
  /** Linha secundária abaixo do nome. */
  sub?: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface Props {
  label: string;
  hideLabel?: boolean;
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  maxResults?: number;
  clearable?: boolean;
  emptyText?: string;
  autoFocus?: boolean;
  className?: string;
}

export function Combobox({
  label, hideLabel = false, value, options, onChange, placeholder = 'Buscar…', maxResults = 80, clearable = false,
  emptyText = 'Nada encontrado', autoFocus = false, className = '',
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find(o => o.value === value);
  const filtered = useMemo(
    () => options.filter(o => matchesQuery(query, o.label, o.value, o.keywords)).slice(0, maxResults),
    [options, query, maxResults],
  );

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const firstEnabled = (list: ComboOption[], from = 0, dir = 1) => {
    for (let i = from; i >= 0 && i < list.length; i += dir) if (!list[i].disabled) return i;
    return -1;
  };

  const openList = () => {
    setOpen(true);
    setQuery('');
    const idx = options.findIndex(o => o.value === value);
    setActive(idx >= 0 && idx < maxResults ? idx : Math.max(0, firstEnabled(options.slice(0, maxResults))));
  };

  const choose = (opt: ComboOption | undefined) => {
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
      e.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const next = firstEnabled(filtered, active + dir, dir);
      if (next >= 0) setActive(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(Math.max(0, firstEnabled(filtered)));
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, firstEnabled(filtered, filtered.length - 1, -1)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  let lastGroup: string | undefined;
  return (
    <div className={`combo ${open ? 'open' : ''} ${className}`}>
      <label className={hideLabel ? 'sr-only' : 'field-label'} htmlFor={`${id}-input`}>
        {label}
      </label>
      <div className="combo-control">
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="input combo-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={open ? selected?.label ?? placeholder : placeholder}
          value={open ? query : selected?.label ?? value}
          onFocus={openList}
          onClick={() => !open && openList()}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {clearable && value && (
          <button
            type="button"
            className="combo-clear"
            aria-label={`Limpar ${label}`}
            title="Limpar"
            onMouseDown={e => e.preventDefault()}
            onClick={() => onChange('')}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" className="combo-list" aria-label={label}>
          {filtered.length === 0 && <li className="combo-empty">{emptyText}</li>}
          {filtered.map((opt, i) => {
            const header = opt.group && opt.group !== lastGroup ? opt.group : null;
            lastGroup = opt.group;
            return (
              <li key={opt.value} role="presentation">
                {header && <div className="combo-group" role="presentation">{header}</div>}
                <div
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={opt.value === value}
                  aria-disabled={opt.disabled || undefined}
                  className={`combo-option${i === active ? ' active' : ''}${opt.value === value ? ' selected' : ''}${opt.disabled ? ' disabled' : ''}`}
                  title={opt.title}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => !opt.disabled && setActive(i)}
                  onClick={() => choose(opt)}
                >
                  <span className="combo-main">
                    <span className="combo-label">{opt.label}</span>
                    {opt.sub && <span className="combo-sub">{opt.sub}</span>}
                  </span>
                  {opt.hint && <span className="combo-hint">{opt.hint}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

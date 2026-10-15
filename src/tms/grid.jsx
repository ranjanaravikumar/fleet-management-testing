import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { timeAgo } from '../api/tms';
import { useNow } from '../hooks/useLiveData';
import { downloadCsv } from './lib';
import { matchesQuery, sortRows, useSort } from './listing';

/**
 * grid.jsx — the dense list grid the ops screens share.
 *
 * One component carries the conventions a desktop TMS user expects, so
 * Shipments and Orders behave the same way: filter tabs with counts, a
 * toolbar (search, columns, saved views, refresh, export), a sticky header
 * with a frozen first column, row selection with a bulk action, keyboard
 * navigation and a status bar.
 *
 * The caller supplies the data and describes its columns and tabs:
 *   columns: [{ id, label, num, sortBy, render, csv, fixed, off }]
 *     sortBy  row => value   sortable when present
 *     render  row => node    cell contents (defaults to sortBy)
 *     csv     row => text    export value (defaults to sortBy)
 *     fixed   true           always shown; can't be hidden
 *     off     true           hidden until the user turns it on
 *   tabs:    [{ id, label, test }]   test row => boolean
 */

// ── Saved views (sessionStorage, per grid; no backend) ───────────────

function readViews(name) {
  try { return JSON.parse(sessionStorage.getItem(`tms-views-${name}`)) || []; } catch { return []; }
}

function writeViews(name, views) {
  try { sessionStorage.setItem(`tms-views-${name}`, JSON.stringify(views)); } catch { /* private mode */ }
}

// ── Toolbar pieces ───────────────────────────────────────────────────

/** A dropdown that closes on its own: <details> needs no outside-click handler. */
function Menu({ label, title, children, width = 230 }) {
  const ref = useRef(null);
  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) ref.current.open = false; }
    function onEsc(e) { if (e.key === 'Escape' && ref.current?.open) ref.current.open = false; }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onEsc); };
  }, []);
  return (
    <details className="tms-menu" ref={ref}>
      <summary className="tms-btn secondary small" title={title}>{label}</summary>
      <div className="tms-menu-pop" style={{ width }}>{children}</div>
    </details>
  );
}

function ColumnMenu({ columns, hidden, onToggle, onReset }) {
  const optional = columns.filter(c => !c.fixed);
  return (
    <Menu label="Columns" title="Show or hide columns">
      <div className="tms-menu-h">Columns</div>
      {optional.map(c => (
        <label key={c.id} className="tms-menu-row">
          <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => onToggle(c.id)} />
          {c.label}
        </label>
      ))}
      <div className="tms-menu-f"><button type="button" className="tms-btn secondary small" onClick={onReset}>Reset</button></div>
    </Menu>
  );
}

function ViewMenu({ views, onSave, onApply, onDelete }) {
  const [name, setName] = useState('');
  return (
    <Menu label="Views" title="Save and reuse this filter, columns and sort" width={260}>
      <div className="tms-menu-h">Saved views</div>
      {views.length === 0 && <div className="tms-menu-empty">None saved yet.</div>}
      {views.map(v => (
        <div key={v.name} className="tms-menu-row">
          <button type="button" className="tms-linkish" onClick={() => onApply(v)}>{v.name}</button>
          <button type="button" className="tms-x" aria-label={`Delete view ${v.name}`} onClick={() => onDelete(v.name)}>×</button>
        </div>
      ))}
      <form className="tms-menu-f" onSubmit={e => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } }}>
        <input className="tms-searchbox" style={{ minWidth: 0, flex: 1 }} value={name} placeholder="Name this view"
               aria-label="Name for the saved view" onChange={e => setName(e.target.value)} />
        <button className="tms-btn small" disabled={!name.trim()}>Save</button>
      </form>
    </Menu>
  );
}

// ── The grid ─────────────────────────────────────────────────────────

export function DataGrid({
  name, live, rows: allRows, tabs, columns, search, rowId, onOpen,
  initialSort, csvName, bulkActions = [], empty = 'Nothing matches. Clear the search or pick another tab.',
}) {
  const [tab, setTab] = useState(tabs[0].id);
  const [q, setQ] = useState('');
  const [sort, onSort] = useSort(initialSort?.key ?? columns[0].id, initialSort?.dir ?? 'asc');
  const [hidden, setHidden] = useState(() => columns.filter(c => c.off).map(c => c.id));
  const [picked, setPicked] = useState(() => new Set());
  const [cursor, setCursor] = useState(null);
  const [views, setViews] = useState(() => readViews(name));
  const searchRef = useRef(null);
  const bodyRef = useRef(null);
  const now = useNow(5000);

  const loaded = Boolean(live.data);
  const test = useMemo(() => tabs.find(t => t.id === tab)?.test ?? (() => true), [tabs, tab]);
  const accessors = useMemo(
    () => Object.fromEntries(columns.filter(c => c.sortBy).map(c => [c.id, c.sortBy])), [columns]);

  const rows = useMemo(
    () => sortRows(allRows.filter(test).filter(r => matchesQuery(q, ...search(r))), sort, accessors),
    [allRows, test, q, search, sort, accessors]);

  const shown = columns.filter(c => !hidden.includes(c.id));
  const ids = useMemo(() => rows.map(rowId), [rows, rowId]);
  const selected = rows.filter(r => picked.has(rowId(r)));
  // Selections and the cursor are filtered against the rows on show rather
  // than pruned in an effect, so changing tab or search can't strand them.
  const at = cursor === null ? -1 : ids.indexOf(cursor);
  const cursorId = at < 0 ? null : cursor;

  const move = useCallback(step => {
    if (!ids.length) return;
    const from = cursor === null ? -1 : ids.indexOf(cursor);
    const next = ids[Math.min(ids.length - 1, Math.max(0, from < 0 ? 0 : from + step))];
    setCursor(next);
    bodyRef.current?.querySelector(`[data-row="${CSS.escape(next)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [ids, cursor]);

  // Keyboard: / focuses search, Esc clears it, arrows move, Enter opens.
  useEffect(() => {
    function onKey(e) {
      const el = e.target;
      const typing = el instanceof HTMLElement
        && (el.matches('input, textarea, select') || el.isContentEditable);
      if (e.key === 'Escape') {
        if (typing && el === searchRef.current) { setQ(''); el.blur(); e.preventDefault(); }
        else if (!typing && q) { setQ(''); e.preventDefault(); }
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return; }
      if (e.key === 'Enter' && cursorId) { e.preventDefault(); onOpen(rows.find(r => rowId(r) === cursorId)); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move, cursorId, rows, rowId, onOpen, q]);

  function toggleAll() {
    setPicked(selected.length === rows.length && rows.length ? new Set() : new Set(ids));
  }

  function toggleOne(id) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exportRows(what) {
    const cols = shown.map(c => ({ label: c.label, value: c.csv || c.sortBy || (() => '') }));
    downloadCsv(csvName(tab), cols, what);
  }

  function saveView(viewName) {
    const next = [...views.filter(v => v.name !== viewName), { name: viewName, tab, q, sort, hidden }];
    setViews(next); writeViews(name, next);
  }

  function applyView(v) {
    setTab(v.tab); setQ(v.q); onSort(v.sort.key, v.sort.dir); setHidden(v.hidden);
  }

  function deleteView(viewName) {
    const next = views.filter(v => v.name !== viewName);
    setViews(next); writeViews(name, next);
  }

  const counts = Object.fromEntries(tabs.map(t => [t.id, loaded ? allRows.filter(t.test).length : undefined]));

  return (
    <div className="tms-panel tms-grid-panel">
      <div className="tms-gridtabs" role="group" aria-label="Filter">
        {tabs.map(t => (
          <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-pressed={tab === t.id}
                  onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] !== undefined && <span className="tms-chip-n">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <div className="tms-gridbar">
        <input ref={searchRef} className="tms-searchbox" type="search" value={q} placeholder="Search  ( / )"
               aria-label={`Search ${name}`} onChange={e => setQ(e.target.value)} />
        <span className="tms-gridbar-sp" />
        {selected.length > 0 && bulkActions.map(a => (
          <button key={a.id} type="button" className="tms-btn secondary small"
                  onClick={() => { a.run(selected); setPicked(new Set()); }}>
            {a.label} ({selected.length})
          </button>
        ))}
        <ViewMenu views={views} onSave={saveView} onApply={applyView} onDelete={deleteView} />
        <ColumnMenu columns={columns} hidden={hidden} onToggle={id => setHidden(h => (h.includes(id) ? h.filter(x => x !== id) : [...h, id]))}
                    onReset={() => setHidden(columns.filter(c => c.off).map(c => c.id))} />
        <button type="button" className="tms-btn secondary small" onClick={live.reload} title="Fetch now">Refresh</button>
        <button type="button" className="tms-btn secondary small" disabled={!rows.length}
                onClick={() => exportRows(rows)}>Export</button>
      </div>

      <div className="tms-grid-scroll">
        <table className="tms-table tms-grid">
          <thead>
            <tr>
              <th className="tms-stick tms-stick-1">
                <input type="checkbox" aria-label="Select every row" checked={rows.length > 0 && selected.length === rows.length}
                       ref={el => { if (el) el.indeterminate = selected.length > 0 && selected.length < rows.length; }}
                       onChange={toggleAll} />
              </th>
              {shown.map((c, i) => {
                const active = sort.key === c.id;
                const pin = i === 0 ? ' tms-stick tms-stick-2' : '';
                return (
                  <th key={c.id} className={`${c.num ? 'tms-num' : ''}${pin}`}
                      aria-sort={!c.sortBy ? undefined : active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {c.sortBy
                      ? (
                        <button type="button" className={`tms-sort${active ? ' on' : ''}`} onClick={() => onSort(c.id)}>
                          {c.label}<span aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                        </button>
                      )
                      : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map(r => {
              const id = rowId(r);
              return (
                <tr key={id} data-row={id} className={`click${cursorId === id ? ' cursor' : ''}${picked.has(id) ? ' picked' : ''}`}
                    onClick={() => { setCursor(id); onOpen(r); }}>
                  <td className="tms-stick tms-stick-1" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={picked.has(id)} aria-label={`Select ${id}`}
                           onChange={() => toggleOne(id)} />
                  </td>
                  {shown.map((c, i) => (
                    <td key={c.id} className={`${c.num ? 'tms-num' : ''}${i === 0 ? ' tms-stick tms-stick-2' : ''}`}>
                      {(c.render || c.sortBy)(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {loaded && rows.length === 0 && <p className="tms-empty">{empty}</p>}
      </div>

      <div className="tms-gridstatus">
        <span>{loaded ? `${rows.length} of ${allRows.length} rows` : 'Loading'}</span>
        <span>{selected.length > 0 ? `${selected.length} selected` : ''}</span>
        <span className="tms-gridbar-sp" />
        <span className="tms-sub">
          {live.error && !live.data ? "Can't reach the TMS. Retrying"
            : live.updatedAt ? `Updated ${timeAgo(new Date(live.updatedAt).toISOString(), now)}` : 'Connecting'}
        </span>
      </div>
    </div>
  );
}

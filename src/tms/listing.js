import { useState } from 'react';

// Sorting and searching for the list screens.

/** [sort, toggle]: click a column once for ascending, again for descending. */
export function useSort(key, dir = 'asc') {
  const [sort, setSort] = useState({ key, dir });
  const toggle = k => setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));
  return [sort, toggle];
}

/** Sort rows by accessors[sort.key](row); blanks always go last. */
export function sortRows(rows, sort, accessors) {
  const get = accessors[sort.key];
  if (!get) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    const xBlank = x === null || x === undefined || x === '';
    const yBlank = y === null || y === undefined || y === '';
    if (xBlank || yBlank) return xBlank === yBlank ? 0 : xBlank ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
    return String(x).localeCompare(String(y), 'en', { numeric: true }) * sign;
  });
}

/** Text filter for a list. Matches every word anywhere in the row's text. */
export function matchesQuery(q, ...values) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = values.filter(v => v !== null && v !== undefined).join(' ').toLowerCase();
  return words.every(w => text.includes(w));
}

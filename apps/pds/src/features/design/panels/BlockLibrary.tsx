import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { BLOCKS } from '../mockData';

/** Searchable base-block library. Insertion is disabled until drafting tools land. */
export const BlockLibrary = () => {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return BLOCKS;
    return BLOCKS.filter(
      (block) =>
        block.name.toLowerCase().includes(needle) ||
        block.category.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <div className="library">
      <div className="search">
        <Icon name="search" size={13} />
        <input
          value={query}
          placeholder="Search blocks"
          aria-label="Search blocks"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {results.length === 0 ? (
        <p className="empty-state">No blocks match “{query}”.</p>
      ) : (
        <ul className="library__list">
          {results.map((block) => (
            <li key={block.id}>
              <div className="library__row">
                <Icon name="library" size={13} />
                <span className="library__text">
                  <span className="library__name">{block.name}</span>
                  <span className="library__meta">
                    {block.category} · size {block.size} · {block.updated}
                  </span>
                </span>
                <button
                  type="button"
                  className="library__insert"
                  title="Insert block — not built yet"
                  disabled
                >
                  <Icon name="plus" size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

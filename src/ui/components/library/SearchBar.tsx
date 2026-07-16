import { Search } from 'lucide-react';
import { useUvpd } from '@/ui/store/uvpd';
import { t } from '@/i18n';

export function SearchBar() {
  const query = useUvpd((s) => s.query);
  const setQuery = useUvpd((s) => s.setQuery);
  return (
    <label
      className="flex flex-1 items-center gap-2 rounded-md px-2.5"
      style={{ background: 'var(--rs-card)', border: '1px solid var(--rs-line)', color: 'var(--rs-tx-3)' }}
    >
      <Search size={14} aria-hidden="true" />
      <input
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        className="w-full bg-transparent py-2 text-[12px] outline-none"
        style={{ color: 'var(--rs-tx)' }}
      />
    </label>
  );
}

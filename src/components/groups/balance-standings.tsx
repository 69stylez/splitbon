'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import { MemberAvatar, memberName, type RowMember } from '@/components/expenses/expense-row';

/**
 * Where everyone stands: green credit bars extend right from the center and red debt bars
 * extend left. Direct settlement partners can be pinned to the top.
 */
export function BalanceStandings({
  balances,
  members,
  currency,
  myId,
  priorityIds = [],
}: {
  balances: { userId: string; paid: number; owes: number; net: number }[];
  members: Map<string, RowMember>;
  currency: string;
  myId: string | undefined;
  priorityIds?: string[];
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const [expanded, setExpanded] = useState(false);
  const priority = new Map(priorityIds.map((id, index) => [id, index]));
  const rows = [...balances].sort((a, b) => {
    const aPriority = priority.get(a.userId);
    const bPriority = priority.get(b.userId);
    if (aPriority !== undefined || bPriority !== undefined) {
      if (aPriority === undefined) return 1;
      if (bPriority === undefined) return -1;
      return aPriority - bPriority;
    }
    return Math.abs(b.net) - Math.abs(a.net);
  });
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  const visibleRows = expanded ? rows : rows.slice(0, 5);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  return (
    <div className="space-y-2.5" data-testid="balance-standings">
      {visibleRows.map((r) => {
        const m = members.get(r.userId);
        const width = `${Math.max(2, (Math.abs(r.net) / max) * 50)}%`;
        const even = Math.abs(r.net) < 1;
        return (
          <div key={r.userId} className="space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <MemberAvatar member={m} id={r.userId} className="h-6 w-6 text-[9px]" ring={r.userId === myId} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {r.userId === myId ? t('detail.you') : memberName(m)}
              </span>
              <span
                className={`shrink-0 font-semibold tabular-nums ${
                  even
                    ? 'text-muted-foreground'
                    : r.net > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {even
                  ? t('detail.balanceEven')
                  : `${r.net > 0 ? t('detail.balanceGets') : t('detail.balancePays')} ${formatCents(Math.abs(r.net), currency, locale)}`}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {!even && (
                <div
                  className={`absolute inset-y-0 rounded-full ${r.net > 0 ? 'left-1/2 bg-emerald-500' : 'right-1/2 bg-red-500'}`}
                  style={{ width }}
                />
              )}
            </div>
          </div>
        );
      })}
      {rows.length > 5 && (
        <button
          type="button"
          className="text-sm font-medium text-primary hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('detail.showFewerBalances') : t('detail.showMoreBalances', { count: hiddenCount })}
        </button>
      )}
    </div>
  );
}

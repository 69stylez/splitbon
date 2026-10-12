'use client';

import { useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import { categoryIcon, categoryLabel } from '@/lib/categories';
import { BudgetBar } from '@/components/groups/stats-extras';
import { CHART_COLORS } from '@/components/groups/stats-charts';

type Totals = {
  paid: number;
  share: number;
  total: number;
  categories: { category: string | null; amount: number }[];
};

/** Spending summary inside the group expenses card. */
export function MySpendingCard({
  totals,
  budget,
  people,
  currency,
  locale,
  paidBy,
  scopeLabel,
  all,
}: {
  totals: Totals;
  budget: number | null;
  people: number;
  currency: string;
  locale: string;
  paidBy: string | undefined;
  scopeLabel: string;
  all: boolean;
}) {
  const t = useTranslations('groups');
  const tExp = useTranslations('expenses');
  const presets = tExp.raw('new.categoryPresets') as string[];
  const money = (c: number) => formatCents(c, currency, locale);

  const top = totals.categories.slice(0, 5);
  const restValue = totals.categories.slice(5).reduce((a, c) => a + c.amount, 0);
  const slices = [
    ...top.map((c) => ({
      label: c.category ? categoryLabel(c.category, presets) : t('stats.noCategory'),
      icon: categoryIcon(c.category),
      value: c.amount,
    })),
    ...(restValue > 0 ? [{ label: t('stats.other'), icon: '…', value: restValue }] : []),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="text-xl font-bold text-foreground tabular-nums">{money(totals.total)}</span> {scopeLabel}
        {paidBy && (
          <>
            <span className="mx-2">·</span>
            {t('detail.paidShort', { name: paidBy })}{' '}
            <span className="font-medium text-foreground tabular-nums">{money(totals.paid)}</span>
          </>
        )}
      </p>

      {slices.length > 0 && totals.share > 0 && (
        <div className="space-y-2">
          <div className="flex h-3 overflow-hidden rounded-full bg-muted">
            {slices.map((s, i) => (
              <div
                key={s.label}
                title={`${s.label}: ${money(s.value)}`}
                style={{
                  width: `${(s.value / totals.share) * 100}%`,
                  backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                }}
              />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {slices.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                {s.icon} {s.label} <span className="tabular-nums">{money(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {budget !== null && budget > 0 && (
        <BudgetBar
          budget={all ? budget : Math.round(budget / Math.max(1, people))}
          spent={totals.share}
          forecast={totals.share}
          currency={currency}
          locale={locale}
        />
      )}
    </div>
  );
}

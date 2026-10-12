'use client';

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc';
import { parseAmountInput, sanitizeAmountInput, formatCents } from '@/lib/money';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Member = { id: string; name: string | null };
type SuggestedPayment = { from: string; to: string; amount: number };

export function SettleDialog({
  groupId,
  members,
  suggestedFrom,
  suggestedTo,
  suggestedAmount,
  suggestions = [],
  onSelectSuggestion,
  currency,
  open,
  onOpenChange,
  paymentActions,
}: {
  groupId: string;
  members: Member[];
  suggestedFrom?: string;
  suggestedTo?: string;
  suggestedAmount?: number;
  suggestions?: SuggestedPayment[];
  onSelectSuggestion?: (suggestion: SuggestedPayment) => void;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Payment buttons (PayPal, bank transfer, ...) shown above the form when the person pays */
  paymentActions?: ReactNode;
}) {
  const t = useTranslations('groups');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settle.title')}</DialogTitle>
          <DialogDescription>{t('settle.description')}</DialogDescription>
        </DialogHeader>

        {open && (
          <SettleDialogBody
            groupId={groupId}
            members={members}
            {...(suggestedFrom !== undefined ? { suggestedFrom } : {})}
            {...(suggestedTo !== undefined ? { suggestedTo } : {})}
            {...(suggestedAmount !== undefined ? { suggestedAmount } : {})}
            suggestions={suggestions}
            {...(onSelectSuggestion !== undefined ? { onSelectSuggestion } : {})}
            currency={currency}
            onOpenChange={onOpenChange}
            paymentActions={paymentActions}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while open so its mode starts fresh for every dialog visit. */
function SettleDialogBody({
  suggestedFrom,
  suggestedTo,
  suggestedAmount,
  suggestions,
  onSelectSuggestion,
  paymentActions,
  ...formProps
}: Omit<Parameters<typeof SettleForm>[0], 'suggestedFrom' | 'suggestedTo' | 'suggestedAmount'> & {
  suggestedFrom?: string;
  suggestedTo?: string;
  suggestedAmount?: number;
  suggestions: SuggestedPayment[];
  onSelectSuggestion?: (suggestion: SuggestedPayment) => void;
  paymentActions?: ReactNode;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  const [showManual, setShowManual] = useState(false);
  const hasSuggestion = suggestedFrom !== undefined && suggestedTo !== undefined && suggestedAmount !== undefined;

  if (!hasSuggestion && !showManual && suggestions.length > 0) {
    const names = new Map(formProps.members.map((member) => [member.id, member.name ?? t('settle.unnamed')]));
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">{t('settle.suggestions')}</p>
        <div className="space-y-2">
          {suggestions.map((suggestion, index) => (
            <Button
              key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}-${index}`}
              type="button"
              variant="outline"
              className="h-auto w-full justify-between py-3 text-left"
              onClick={() => onSelectSuggestion?.(suggestion)}
            >
              <span>
                {names.get(suggestion.from)} → {names.get(suggestion.to)}
              </span>
              <span className="tabular-nums">{formatCents(suggestion.amount, formProps.currency, locale)}</span>
            </Button>
          ))}
        </div>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setShowManual(true)}>
          {t('settle.manual')}
        </Button>
      </div>
    );
  }

  if (paymentActions && !showManual) {
    return (
      <div className="space-y-3">
        {paymentActions}
        <Button type="button" variant="outline" className="w-full" onClick={() => setShowManual(true)}>
          {t('settle.manual')}
        </Button>
      </div>
    );
  }

  return (
    <>
      {paymentActions}
      <SettleForm
        {...formProps}
        {...(suggestedFrom !== undefined ? { suggestedFrom } : {})}
        {...(suggestedTo !== undefined ? { suggestedTo } : {})}
        {...(suggestedAmount !== undefined ? { suggestedAmount } : {})}
      />
    </>
  );
}

function SettleForm({
  groupId,
  members,
  suggestedFrom,
  suggestedTo,
  suggestedAmount,
  currency,
  onOpenChange,
}: {
  groupId: string;
  members: Member[];
  suggestedFrom?: string;
  suggestedTo?: string;
  suggestedAmount?: number;
  currency: string;
  onOpenChange: (open: boolean) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('groups');
  const [fromId, setFromId] = useState(suggestedFrom ?? '');
  const [toId, setToId] = useState(suggestedTo ?? '');
  const [amountStr, setAmountStr] = useState(suggestedAmount ? (suggestedAmount / 100).toFixed(2) : '');
  const [note, setNote] = useState('');

  const utils = trpc.useUtils();
  const settle = trpc.settlements.create.useMutation({
    onSuccess: () => {
      utils.balances.getGroupBalances.invalidate({ groupId });
      utils.balances.getSimplifiedDebts.invalidate({ groupId });
      utils.balances.getDashboard.invalidate();
      utils.settlements.list.invalidate({ groupId });
      onOpenChange(false);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseAmountInput(amountStr);
    if (!toId || amount <= 0) return;
    settle.mutate({ groupId, fromId: fromId || undefined, toId, amount, currency, note: note || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="from">{t('settle.from')}</Label>
        <select
          id="from"
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          required
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('settle.selectMember')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? t('settle.unnamed')}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="to">{t('settle.to')}</Label>
        <select
          id="to"
          value={toId}
          onChange={(e) => setToId(e.target.value)}
          required
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('settle.selectMember')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? t('settle.unnamed')}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="settle-amount">{t('settle.amount')}</Label>
        <Input
          id="settle-amount"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={amountStr}
          onChange={(e) => setAmountStr(sanitizeAmountInput(e.target.value))}
          required
        />
        {suggestedAmount && (
          <button
            type="button"
            onClick={() => setAmountStr((suggestedAmount / 100).toFixed(2))}
            className="text-xs text-primary hover:underline"
          >
            {t('settle.useSuggested', { amount: formatCents(suggestedAmount, currency, locale) })}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="note">{t('settle.note')}</Label>
        <Input
          id="note"
          placeholder={t('settle.notePlaceholder')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {settle.error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{settle.error.message}</div>
      )}

      <Button type="submit" className="w-full" disabled={settle.isPending}>
        {settle.isPending ? t('settle.submitting') : t('settle.submit')}
      </Button>
    </form>
  );
}

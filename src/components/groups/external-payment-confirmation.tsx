'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/money';

/** A payment link is not a payment receipt. Only the person can confirm it here. */
export function ExternalPaymentConfirmation({
  amount,
  currency,
  name,
  pending,
  onPaid,
  onDismiss,
}: {
  amount: number;
  currency: string;
  name: string;
  pending: boolean;
  onPaid: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('groups');
  const locale = useLocale();
  return (
    <section
      className="space-y-3 rounded-xl border border-primary/30 bg-accent/30 p-4"
      aria-live="polite"
      data-testid="external-payment-confirmation"
    >
      <p className="font-medium">
        {t('payment.externalTitle', { amount: formatCents(amount, currency, locale), name })}
      </p>
      <p className="text-sm text-muted-foreground">{t('payment.externalHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={onPaid} data-testid="external-payment-paid">
          {pending ? t('settle.submitting') : t('payment.markPaid')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onDismiss}
          data-testid="external-payment-unpaid"
        >
          {t('payment.notPaid')}
        </Button>
      </div>
    </section>
  );
}

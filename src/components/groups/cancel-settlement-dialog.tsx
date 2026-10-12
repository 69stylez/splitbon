'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function CancelSettlementDialog({ groupId, settlementId }: { groupId: string; settlementId: string }) {
  const t = useTranslations('groups');
  const common = useTranslations('common');
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cancel = trpc.settlements.cancel.useMutation({
    onSuccess: () => {
      void utils.activity.getGroupActivity.invalidate({ groupId });
      void utils.activity.getRecentActivity.invalidate();
      void utils.settlements.list.invalidate({ groupId });
      void utils.balances.invalidate();
      setOpen(false);
      setReason('');
    },
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          cancel.reset();
          setOpen(true);
        }}
      >
        {t('settle.cancelRecorded')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!cancel.isPending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settle.cancelTitle')}</DialogTitle>
            <DialogDescription>{t('settle.cancelDescription')}</DialogDescription>
          </DialogHeader>
          <Label htmlFor={`cancel-reason-${settlementId}`}>{t('settle.cancelReason')}</Label>
          <Input
            id={`cancel-reason-${settlementId}`}
            maxLength={500}
            value={reason}
            disabled={cancel.isPending}
            onChange={(event) => setReason(event.target.value)}
          />
          {cancel.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('settle.cancelError')}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={cancel.isPending} onClick={() => setOpen(false)}>
              {common('cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ groupId, settlementId, reason })}
            >
              {t('settle.cancelConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

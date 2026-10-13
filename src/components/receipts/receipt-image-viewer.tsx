'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

type ReceiptImageViewerProps = {
  src: string;
  alt: string;
  imageClassName?: string;
  triggerLabel?: string;
};

/** Opens receipt photos inside the app so mobile users always have a clear way back. */
export function ReceiptImageViewer({ src, alt, imageClassName, triggerLabel }: ReceiptImageViewerProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('expenses.receipt');
  const common = useTranslations('common');

  return (
    <>
      {triggerLabel ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="receipt-image-open"
          onClick={() => setOpen(true)}
        >
          {triggerLabel}
        </Button>
      ) : (
        <button
          type="button"
          className="block w-full cursor-zoom-in text-left"
          aria-label={t('viewImage')}
          data-testid="receipt-image-open"
          onClick={() => setOpen(true)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded receipt dimensions are unknown */}
          <img src={src} alt={alt} loading="lazy" className={imageClassName} />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-3 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:max-w-3xl"
          data-testid="receipt-image-viewer"
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <DialogTitle className="truncate text-sm">{alt}</DialogTitle>
            <DialogClose
              render={<Button type="button" variant="ghost" size="icon" data-testid="receipt-image-close-icon" />}
            >
              <span aria-hidden="true">×</span>
              <span className="sr-only">{common('close')}</span>
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded receipt dimensions are unknown */}
            <img src={src} alt={alt} className="mx-auto h-auto max-h-full w-auto max-w-full object-contain" />
          </div>
          <DialogClose
            render={<Button type="button" variant="outline" className="w-full" data-testid="receipt-image-close" />}
          >
            {common('close')}
          </DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

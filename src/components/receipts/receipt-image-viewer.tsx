'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';

type ReceiptImageViewerProps = {
  src: string;
  alt: string;
  imageClassName?: string;
};

/** Opens receipt photos inside the app so mobile users always have a clear way back. */
export function ReceiptImageViewer({ src, alt, imageClassName }: ReceiptImageViewerProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations('expenses.receipt');
  const common = useTranslations('common');

  return (
    <>
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[94dvh] max-w-[calc(100%-1rem)] gap-3 p-3 sm:max-w-3xl"
          data-testid="receipt-image-viewer"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <div className="min-h-0 overflow-auto rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded receipt dimensions are unknown */}
            <img src={src} alt={alt} className="mx-auto max-h-[76dvh] w-auto max-w-full object-contain" />
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

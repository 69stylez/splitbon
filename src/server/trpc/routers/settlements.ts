import { z } from 'zod';
import { money, sendNotifications } from '../../lib/notifications';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, groupMemberProcedure } from '../init';
import { getExchangeRate, convertCents } from '../../lib/exchange-rates';
import { MAX_MONEY_CENTS } from '@/lib/money';

export const settlementsRouter = createTRPCRouter({
  // This corrects a recorded payment, not an external transfer or refund.
  cancel: groupMemberProcedure
    .input(z.object({ groupId: z.string(), settlementId: z.string(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const settlement = await tx.settlement.findFirst({
          where: { id: input.settlementId, groupId: input.groupId },
        });
        if (!settlement) throw new TRPCError({ code: 'NOT_FOUND', message: 'Settlement not found' });

        const creator = await tx.activityLog.findFirst({
          where: { groupId: input.groupId, entityId: settlement.id, type: 'SETTLEMENT_CREATED', userId: ctx.user.id },
          select: { id: true },
        });
        if (
          ctx.membership.role === 'MEMBER' &&
          settlement.fromId !== ctx.user.id &&
          settlement.toId !== ctx.user.id &&
          !creator
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only payment parties, its creator or a group admin can cancel',
          });
        }

        // Compare-and-set: concurrent/retried cancellations produce exactly one audit entry.
        const canceledAt = new Date();
        const updated = await tx.settlement.updateMany({
          where: { id: settlement.id, groupId: input.groupId, canceledAt: null },
          data: { canceledAt },
        });
        if (updated.count === 0) return { id: settlement.id, canceled: true };

        await tx.activityLog.create({
          data: {
            groupId: input.groupId,
            userId: ctx.user.id,
            type: 'SETTLEMENT_CANCELED',
            entityId: settlement.id,
            metadata: {
              fromId: settlement.fromId,
              toId: settlement.toId,
              amount: settlement.amount,
              currency: settlement.currency,
              baseCurrencyAmount: settlement.baseCurrencyAmount,
              reason: input.reason ?? '',
            },
          },
        });
        return { id: settlement.id, canceled: true };
      });
    }),

  list: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.db.settlement.findMany({
        where: { groupId: input.groupId },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor } } : {}),
        include: {
          from: { select: { id: true, name: true, image: true } },
          to: { select: { id: true, name: true, image: true } },
        },
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
      });

      let nextCursor: string | undefined;
      if (items.length > input.limit) {
        const next = items.pop();
        nextCursor = next?.id;
      }

      return { items, nextCursor };
    }),

  create: groupMemberProcedure
    .input(
      z.object({
        groupId: z.string(),
        fromId: z.string().optional(),
        toId: z.string(),
        amount: z.number().int().positive().max(MAX_MONEY_CENTS),
        currency: z
          .string()
          .length(3)
          .regex(/^[a-zA-Z]{3}$/)
          .transform((c) => c.toUpperCase())
          .default('USD'),
        exchangeRate: z.number().positive().finite().max(1_000_000).optional(), // manual override
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const effectiveFromId = input.fromId ?? ctx.user.id;

      // Block settlements on archived groups
      const group = await ctx.db.group.findUnique({
        where: { id: input.groupId },
        select: { archivedAt: true, currency: true },
      });
      if (group?.archivedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot create settlements in an archived group',
        });
      }

      // Cannot settle with yourself
      if (effectiveFromId === input.toId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot settle a debt with yourself',
        });
      }

      // Security: non-admin members can only create settlements from themselves
      if (ctx.membership.role === 'MEMBER' && input.fromId && input.fromId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only record payments from yourself',
        });
      }

      // Validate both fromId and toId are members of the group
      const memberCount = await ctx.db.groupMember.count({
        where: {
          groupId: input.groupId,
          userId: { in: [effectiveFromId, input.toId] },
        },
      });
      if (memberCount < (effectiveFromId === input.toId ? 1 : 2)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Both the payer and recipient must be members of this group',
        });
      }

      // Currency conversion: compute base currency amount if currencies differ
      const groupCurrency = group?.currency ?? 'USD';
      let exchangeRate: number | null = null;
      let baseCurrencyAmount: number | null = null;

      if (input.currency.toUpperCase() !== groupCurrency.toUpperCase()) {
        if (input.exchangeRate) {
          exchangeRate = input.exchangeRate;
        } else {
          exchangeRate = await getExchangeRate(input.currency, groupCurrency);
        }

        if (exchangeRate === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Could not fetch exchange rate. Please provide a manual rate or try again.',
          });
        }

        baseCurrencyAmount = convertCents(input.amount, exchangeRate);
      }

      const settlement = await ctx.db.$transaction(async (tx) => {
        const created = await tx.settlement.create({
          data: {
            groupId: input.groupId,
            fromId: effectiveFromId,
            toId: input.toId,
            amount: input.amount,
            currency: input.currency,
            exchangeRate: exchangeRate ?? 1.0,
            baseCurrencyAmount,
            ...(input.note !== undefined ? { note: input.note } : {}),
          },
        });

        await tx.activityLog.create({
          data: {
            groupId: input.groupId,
            userId: ctx.user.id,
            type: 'SETTLEMENT_CREATED',
            entityId: created.id,
            metadata: { toId: input.toId, amount: input.amount, currency: input.currency },
          },
        });

        return created;
      });

      if (settlement.toId !== ctx.user.id) {
        const actor = await ctx.db.user.findUnique({ where: { id: settlement.fromId }, select: { name: true } });
        void sendNotifications(ctx.db, [
          {
            userId: settlement.toId,
            kind: 'SETTLEMENT',
            groupId: input.groupId,
            entityId: settlement.id,
            vars: { actor: actor?.name ?? '?', amount: money(input.amount, input.currency) },
          },
        ]);
      }

      return settlement;
    }),
});

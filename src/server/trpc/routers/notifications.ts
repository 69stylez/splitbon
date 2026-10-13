import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure, groupMemberProcedure } from '../init';
import { getVapidKeys, sendNotifications } from '../../lib/notifications';
import { checkRateLimit, refundRateLimit } from '../../lib/rate-limit';
import { buildPaypalMeUrl, isValidPaypalEmail, isValidIban } from '@/lib/payments';

/** The bell: stored notifications of the signed-in user, plus the settings and devices for push. */
export const notificationsRouter = createTRPCRouter({
  requestPaymentDetails: groupMemberProcedure
    .input(z.object({ userId: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remind yourself' });
      const recipient = await ctx.db.groupMember.findUnique({
        where: { userId_groupId: { userId: input.userId, groupId: input.groupId } },
        include: { user: true },
      });
      if (!recipient) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipient is not a group member' });
      const user = recipient.user;
      if (user.isPlaceholder || user.suspendedAt || !user.notifyEnabled) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This person cannot receive notifications' });
      }
      if (
        (user.paypalMeName && buildPaypalMeUrl(user.paypalMeName, 100, 'EUR')) ||
        (user.paypalEmail && isValidPaypalEmail(user.paypalEmail)) ||
        (user.iban && isValidIban(user.iban))
      ) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment details are already available. Please reload.' });
      }
      const recent = await ctx.db.notification.findFirst({
        where: {
          userId: input.userId,
          groupId: input.groupId,
          type: 'PAYMENT_DETAILS_REQUEST',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      });
      if (recent)
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'This person has already been reminded in the last 24 hours',
        });
      const key = `payment-details:${input.groupId}:${input.userId}`;
      if (!checkRateLimit(key, 1, 24 * 60 * 60 * 1000).allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'This person has already been reminded in the last 24 hours',
        });
      }
      const startedAt = new Date();
      try {
        await sendNotifications(ctx.db, [
          {
            userId: input.userId,
            kind: 'PAYMENT_DETAILS_REQUEST',
            groupId: input.groupId,
            entityId: ctx.user.id,
            vars: { actor: ctx.user.name ?? 'A group member' },
          },
        ]);
        const stored = await ctx.db.notification.findFirst({
          where: {
            userId: input.userId,
            groupId: input.groupId,
            type: 'PAYMENT_DETAILS_REQUEST',
            entityId: ctx.user.id,
            createdAt: { gte: startedAt },
          },
        });
        if (!stored)
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Could not store the reminder. Please try again.',
          });
        return { stored: true };
      } catch (error) {
        refundRateLimit(key);
        throw error;
      }
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const [items, unread] = await Promise.all([
      ctx.db.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: 'desc' }, take: 40 }),
      ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    ]);
    return { items, unread };
  }),

  unreadCount: protectedProcedure.query(({ ctx }) =>
    ctx.db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ),

  markRead: protectedProcedure.input(z.object({ id: z.string().optional() })).mutation(async ({ ctx, input }) => {
    await ctx.db.notification.updateMany({
      where: { userId: ctx.user.id, readAt: null, ...(input.id ? { id: input.id } : {}) },
      data: { readAt: new Date() },
    });
    return { success: true };
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({ where: { id: ctx.user.id }, select: { notifyEnabled: true } });
    const keys = await getVapidKeys(ctx.db);
    return {
      enabled: user?.notifyEnabled ?? true,
      vapidPublicKey: keys.publicKey,
      devices: await ctx.db.pushSubscription.count({ where: { userId: ctx.user.id } }),
    };
  }),

  setEnabled: protectedProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    await ctx.db.user.update({ where: { id: ctx.user.id }, data: { notifyEnabled: input.enabled } });
    return { enabled: input.enabled };
  }),

  subscribe: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1000),
        p256dh: z.string().max(200),
        auth: z.string().max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { userId: ctx.user.id, ...input },
        update: { userId: ctx.user.id, p256dh: input.p256dh, auth: input.auth },
      });
      return { success: true };
    }),

  unsubscribe: protectedProcedure
    .input(z.object({ endpoint: z.string().max(1000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.pushSubscription.deleteMany({ where: { userId: ctx.user.id, endpoint: input.endpoint } });
      return { success: true };
    }),
});

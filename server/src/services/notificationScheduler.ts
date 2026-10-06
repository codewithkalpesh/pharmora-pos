import { database, type DbClient } from './domainUtils.js';
import { getTelegramConfig, sendDailySummary, sendMonthlySummary } from './telegramService.js';

let schedulerTimer: NodeJS.Timeout | null = null;
let isRunning = false;

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const runScheduledTasks = async (client?: DbClient): Promise<{
  dailySummarySent: boolean;
  monthlySummarySent: boolean;
  skippedReason?: string;
}> => {
  const db = database(client);

  const config = await getTelegramConfig(client);
  if (!config.configured || !config.enabled) {
    return { dailySummarySent: false, monthlySummarySent: false, skippedReason: 'Telegram not configured or disabled' };
  }

  let dailySummarySent = false;
  let monthlySummarySent = false;

  const now = new Date();
  const currentHour = now.getHours(); // 0 - 23
  const todayStr = getTodayStr();

  // 1. Check Daily Summary (Trigger after 21:00 / 9:00 PM if enabled and not already sent today)
  if (config.preferences.dailySummary && currentHour >= 21) {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const alreadySentToday = await db.telegramEvent.findFirst({
      where: {
        eventType: 'DAILY_SUMMARY',
        status: 'SENT',
        createdAt: { gte: startOfToday },
      },
    });

    if (!alreadySentToday) {
      const res = await sendDailySummary(now, client);
      if (res.success) {
        dailySummarySent = true;
      }
    }
  }

  // 2. Check Monthly Summary (Trigger on 1st of month after 08:00 AM for previous month if not already sent)
  if (config.preferences.monthlySummary && now.getDate() === 1 && currentHour >= 8) {
    const currentMonthKey = getMonthStr();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const alreadySentThisMonth = await db.telegramEvent.findFirst({
      where: {
        eventType: 'MONTHLY_SUMMARY',
        status: 'SENT',
        createdAt: { gte: startOfToday },
      },
    });

    if (!alreadySentThisMonth) {
      const res = await sendMonthlySummary(undefined, undefined, client);
      if (res.success) {
        monthlySummarySent = true;
      }
    }
  }

  return {
    dailySummarySent,
    monthlySummarySent,
  };
};

export const startNotificationScheduler = (intervalMs: number = 60000) => {
  if (schedulerTimer) return;
  isRunning = true;

  // Run initial check after 10 seconds of boot
  setTimeout(() => {
    if (isRunning) {
      runScheduledTasks().catch((err) => {
        console.error('Notification scheduler error:', err);
      });
    }
  }, 10000);

  schedulerTimer = setInterval(() => {
    if (isRunning) {
      runScheduledTasks().catch((err) => {
        console.error('Notification scheduler error:', err);
      });
    }
  }, intervalMs);
};

export const stopNotificationScheduler = () => {
  isRunning = false;
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
};

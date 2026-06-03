import cron from "node-cron";

export function scheduleDaily(time: string, task: () => Promise<void>): () => void {
  const [hStr, mStr] = time.split(":");
  const expr = `${Number(mStr)} ${Number(hStr)} * * *`;
  const job = cron.schedule(expr, () => {
    task().catch((err) => console.error("[scheduler] task failed:", err));
  });
  return () => job.stop();
}

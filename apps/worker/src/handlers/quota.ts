import type { DbPool, DbClient } from '@relay/database';

export async function checkProjectDailyTokenBudget(
  db: DbPool | DbClient,
  projectId: string,
  dailyBudget: number,
  estimatedTokensForCall: number
): Promise<{ allowed: boolean; currentTotal: number; remaining: number }> {
  const sql = `
    SELECT coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint as total_tokens
    FROM public.ai_usage
    WHERE project_id = $1
      AND created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  `;

  const res = await db.query<{ total_tokens: string }>(sql, [projectId]);
  const currentTotal = parseInt(res.rows[0]?.total_tokens ?? '0', 10);
  const remaining = Math.max(0, dailyBudget - currentTotal);

  if (currentTotal + estimatedTokensForCall > dailyBudget) {
    return { allowed: false, currentTotal, remaining };
  }

  return { allowed: true, currentTotal, remaining };
}

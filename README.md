# fleet-scheduler

The fleet's clock: a Cloudflare Worker that dispatches every agent's
GitHub workflow at its **exact** minute.

## Why it exists

GitHub's `schedule` events are best-effort — minutes-to-hours late under
load, deprioritized queues, occasionally dropped outright (fleet lesson,
2026-07-04). `workflow_dispatch` runs, by contrast, start within seconds.
So the schedule moves off GitHub: Cloudflare cron triggers fire
punctually, and this Worker POSTs a `workflow_dispatch` for each agent at
its scheduled minute.

The agents' own GitHub crons **stay in place as backups** — late but
reliable. Their dedupe guards recognize scheduler dispatches (the Worker
passes `source=scheduler`), so a cron run skips when the dispatch already
handled the period; if Cloudflare ever fails, the cron still delivers.
Truly-manual runs (a human clicking "Run workflow", no `source` input)
always proceed.

## How it works

- `wrangler.jsonc` — one cron trigger, `* * * * *` (a tick a minute is
  simpler than juggling per-time triggers, and free-plan cheap).
- `worker.js` — on each tick, matches the tick's UTC `hh:mm` (+ weekday
  for the weekly agents) against the `SCHEDULE` table and dispatches
  whatever is due, using `controller.scheduledTime` so drift can't skew
  the match. Dispatch failures alert on Telegram — a broken scheduler
  must never be silent — while the GitHub backup crons still deliver.
- Failure containment mirrors the fleet: one repo's failed dispatch never
  blocks the others (`Promise.allSettled`).

## Deploy (once)

1. Cloudflare account (free): https://dash.cloudflare.com/sign-up
2. `cd fleet_scheduler && npx wrangler login`
3. Fine-grained GitHub PAT: Repository access = the fleet's cloud repos,
   Permissions → **Actions: Read and write** (Metadata comes along).
4. Secrets:
   `npx wrangler secret put GH_PAT`
   `npx wrangler secret put TELEGRAM_BOT_TOKEN`
   `npx wrangler secret put TELEGRAM_CHAT_ID`
5. `npx wrangler deploy`

Verify: `npx wrangler tail` and wait for a scheduled minute — the tick
log lists what was due and dispatched; the agent's Actions page shows a
`workflow_dispatch` run started within seconds of the minute.

## Changing the schedule

Edit `SCHEDULE` in `worker.js` (UTC, with the IST time in the comment),
`npx wrangler deploy`. Keep the agent's own workflow cron as the backup
and the daily-review watchdog's roster in sync.

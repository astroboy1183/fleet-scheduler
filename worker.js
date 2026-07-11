// fleet-scheduler — the fleet's clock.
//
// GitHub's cron scheduler is best-effort: minutes-to-hours late under load,
// occasionally dropped entirely (fleet lesson from 2026-07-04). But
// workflow_dispatch runs start within seconds. So the schedule lives HERE —
// Cloudflare cron triggers fire punctually — and each agent's workflow is
// dispatched at its exact minute. The agents' own GitHub crons stay in place
// as late-but-reliable backups; their guards skip when a dispatched run
// already handled the period.
//
// Secrets (wrangler secret put): GH_PAT (fine-grained, Actions: write on the
// fleet repos), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (dispatch-failure alerts).

const OWNER = "astroboy1183";

// UTC schedule. dow: 0=Sun … 6=Sat (UTC weekday); omitted = daily.
// IST = UTC+5:30 — the comments carry the IST time the fleet reasons in.
export const SCHEDULE = [
  // ── the 06:00 IST fleet — one tick carries them all ──────────────────
  { utc: "00:30", repo: "weather-report", workflow: "weather-report.yml" },   // 06:00 IST
  { utc: "00:30", repo: "mail-digest", workflow: "mail-digest.yml" },         // 06:00 IST
  { utc: "00:30", repo: "news-briefing", workflow: "news-briefing.yml" },     // 06:00 IST
  { utc: "00:30", repo: "cricket-scores", workflow: "cricket-scores.yml" },   // 06:00 IST
  { utc: "00:30", repo: "tech-news", workflow: "tech-news.yml" },             // 06:00 IST
  { utc: "00:30", repo: "finance-tracker", workflow: "finance-tracker.yml" }, // 06:00 IST
  { utc: "00:30", repo: "eng-blogs", workflow: "eng-blogs.yml" },             // 06:00 IST
  { utc: "00:30", repo: "repo-review", workflow: "repo-review.yml" },         // 06:00 IST
  { utc: "00:30", repo: "papers-digest", workflow: "papers-digest.yml", dow: 6 }, // Sat 06:00 IST
  // ── conditional extra editions (silent unless they have something) ───
  { utc: "08:07", repo: "cricket-scores", workflow: "cricket-scores.yml" },   // 13:37 IST lunch (India match days only)
  { utc: "13:30", repo: "mail-digest", workflow: "mail-digest.yml" },         // 19:00 IST sweep (can't-wait mail only)
  { utc: "13:45", repo: "tech-news", workflow: "tech-news.yml" },             // 19:15 IST wrap (new since morning; new exploited CVEs always)
  { utc: "15:30", repo: "news-briefing", workflow: "news-briefing.yml" },     // 21:00 IST wrap (new since morning)
  { utc: "16:17", repo: "cricket-scores", workflow: "cricket-scores.yml" },   // 21:47 IST evening edition
];

async function dispatch(env, entry) {
  const url =
    `https://api.github.com/repos/${OWNER}/${entry.repo}` +
    `/actions/workflows/${entry.workflow}/dispatches`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_PAT}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "fleet-scheduler",
      "Content-Type": "application/json",
    },
    // source=scheduler lets the workflow guards tell this dispatch apart
    // from a human clicking "Run workflow" (humans always proceed).
    body: JSON.stringify(
      entry.manual ? { ref: "main" }
                   : { ref: "main", inputs: { source: "scheduler" } },
    ),
  });
  if (!resp.ok) {
    throw new Error(`${entry.repo}: HTTP ${resp.status} ${await resp.text()}`);
  }
}

async function alert(env, text) {
  // Scheduler failures must surface like any agent failure: on Telegram.
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      },
    );
    if (!resp.ok) {
      console.log(JSON.stringify({ event: "alert_failed", status: resp.status }));
    }
  } catch (err) {
    console.log(JSON.stringify({ event: "alert_failed", error: String(err) }));
  }
}

export default {
  async scheduled(controller, env, ctx) {
    // controller.scheduledTime is the trigger's exact minute — immune to
    // small startup drift in Date.now().
    const now = new Date(controller.scheduledTime);
    const hhmm = now.toISOString().slice(11, 16);
    const dow = now.getUTCDay();
    const due = SCHEDULE.filter(
      (e) => e.utc === hhmm && (e.dow === undefined || e.dow === dow),
    );
    if (due.length === 0) {
      return;
    }

    const results = await Promise.allSettled(due.map((e) => dispatch(env, e)));
    const failed = results
      .map((r, i) => (r.status === "rejected" ? String(r.reason) : null))
      .filter(Boolean);
    console.log(
      JSON.stringify({
        event: "tick",
        utc: hhmm,
        due: due.map((e) => e.repo),
        dispatched: due.length - failed.length,
        failed,
      }),
    );
    if (failed.length > 0) {
      // The GitHub backup crons still deliver (late) even if this alert is
      // all that happens — but a broken scheduler must never be silent.
      await alert(env, `⚠️ fleet-scheduler: dispatch failed — ${failed.join("; ")}`);
    }
  },
};

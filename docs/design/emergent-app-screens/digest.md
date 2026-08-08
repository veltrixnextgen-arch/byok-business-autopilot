# Digest — `/app/digest`

**Purpose:** the daily summary — what happened, what's waiting, what's still moving, and what it cost. Dated per day (captured showing "Friday, August 7").

## Layout

1. **Date header** — the digest's date, prominent.
2. **Quad grid**, four equal panels:
   - **Completed** — work finished since the last digest.
   - **Waiting on you** — items blocked on founder input/approval (likely overlaps with the Approvals queue, but summarized here rather than actionable).
   - **In progress** — work currently underway.
   - **Agent notes** — free-form observations/flags agents surfaced, not tied to a specific task.
3. **Cost breakdown** — a section beneath the grid summarizing spend (presumably by team/agent, consistent with the cost-by-team pattern also seen on the dashboard).
4. **Suggestions** — a panel of agent-generated suggestions for the founder, same pattern as the dashboard's suggestions panel (likely a shared component between the two screens).

## Notes for whoever builds this

- Structurally this looks like a rollup of the same underlying activity feed / cost data that powers the Dashboard (`/app`) and Approvals — likely not a new data source, just a different time-windowed view (today vs. live) of the same event stream.
- "Agent notes" is the one category without an obvious existing analog — worth checking whether agents already have any mechanism to leave a note that isn't a task or an approval request.
- No settings/notification-frequency control was visible on this screen itself — that lives on `/app/settings` ("Daily digest" toggle, already noted as existing there), so digest generation is presumably a scheduled job, not user-triggered.

# Approvals queue — `/app/approvals`

**Purpose:** the founder's inbox for anything an agent needs explicit sign-off on before it happens. Sidebar shows a live count badge (e.g. "3").

## Layout

Deliberately **one item at a time**, not a scannable list/table — a single centered card:

1. **Progress indicator** — a bar or counter showing position in the queue (e.g. "item 1 of 3"), so the founder knows how much is left without seeing the whole queue at once.
2. **Why** — the agent's stated reasoning for why this action needs approval / why it wants to do it.
3. **If you approve** — a plain-language statement of exactly what happens next if the founder says yes.
4. **Estimated cost** — a dollar figure or cost range tied to the action, shown before the decision, not after.
5. **Action row** — three buttons: **Approve**, **Request changes**, **Reject**. Three distinct outcomes, not a binary yes/no — "Request changes" implies the action goes back to the agent with feedback rather than being rejected outright.

## Notes for whoever builds this

- This is a direct UI for `packages/approval-queue`'s existing autonomy engine / approval store / deny list / audit log — the backend model (why / cost estimate / approve-reject-changes outcomes) should already exist there; check its shape against this layout before designing new fields.
- The one-at-a-time presentation is a deliberate design choice worth preserving: it forces a real decision per item rather than a bulk-approve pattern, which fits the product's "nothing irreversible happens without you" positioning (see the Charter spec).
- "Request changes" needs a defined path back to the agent — worth confirming with product whether the approval-queue backend already models a revise/retry loop or whether that's new scope.

import { cx } from "../ui";
import { RwCard, SectionContainer, SectionEyebrow, SectionHeading } from "./primitives";

const COLUMNS = ["Traditional hiring", "Freelancers", "Generic AI chat", "Runwisely"] as const;

const ROWS: Array<{ capability: string; values: [boolean, boolean, boolean, boolean] }> = [
  { capability: "Company structure", values: [true, false, false, true] },
  { capability: "Persistent agents", values: [true, true, false, true] },
  { capability: "Task ownership", values: [true, true, false, true] },
  { capability: "Approvals", values: [true, true, false, true] },
  { capability: "Spending controls", values: [true, true, false, true] },
  { capability: "Business context", values: [true, true, false, true] },
  { capability: "Human oversight", values: [true, true, true, true] },
];

function Mark({ present, strong }: { present: boolean; strong: boolean }) {
  if (!present) return <span className="text-text-muted">—</span>;
  return <span className={cx("font-semibold", strong ? "text-accent" : "text-text-secondary")}>✓</span>;
}

export function ValueComparison() {
  return (
    <SectionContainer>
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <SectionEyebrow>Value</SectionEyebrow>
        <SectionHeading>What actually gets you a company.</SectionHeading>
        <p className="text-text-secondary">Structural comparison of common approaches to getting the work of a business done.</p>
      </div>

      <RwCard className="mt-10 overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className="px-6 py-4 font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">Capability</th>
              {COLUMNS.map((col) => (
                <th
                  key={col}
                  className={cx(
                    "px-6 py-4 font-mono text-[10px] uppercase tracking-[0.1em]",
                    col === "Runwisely" ? "text-accent" : "text-text-muted",
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.capability} className="border-b border-border-subtle last:border-0">
                <td className="px-6 py-4 text-text">{row.capability}</td>
                {row.values.map((present, i) => (
                  <td key={COLUMNS[i]} className="px-6 py-4">
                    <Mark present={present} strong={i === 3} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </RwCard>
    </SectionContainer>
  );
}

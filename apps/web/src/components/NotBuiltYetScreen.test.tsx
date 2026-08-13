import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { NotBuiltYetScreen } from "./NotBuiltYetScreen";

afterEach(() => cleanup());

describe("NotBuiltYetScreen", () => {
  it("shows the title and an honest not-built message, not fabricated data", () => {
    render(<NotBuiltYetScreen active="/approvals" title="Approvals" note="Nothing here yet." />);

    expect(screen.getByText("Not built yet")).toBeTruthy();
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
    expect(screen.getAllByText("Approvals").length).toBeGreaterThan(0);
  });
});

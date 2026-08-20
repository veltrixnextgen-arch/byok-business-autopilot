import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

import { useAuthGuard } from "./useAuthGuard";

afterEach(() => {
  cleanup();
  navigateMock.mockClear();
});

function Probe({ check }: { check: () => Promise<"/login" | "/onboarding" | null> }) {
  const status = useAuthGuard(check);
  return <div data-testid="status">{status}</div>;
}

describe("useAuthGuard", () => {
  it("starts in 'checking' and flips to 'ready' once the check resolves with no redirect", async () => {
    let resolveCheck!: (value: null) => void;
    const check = vi.fn(() => new Promise<null>((resolve) => (resolveCheck = resolve)));

    render(<Probe check={check} />);
    expect(screen.getByTestId("status").textContent).toBe("checking");

    await act(async () => resolveCheck(null));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to the returned target and never flips to 'ready'", async () => {
    const check = vi.fn().mockResolvedValue("/login");

    render(<Probe check={check} />);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }));
    expect(screen.getByTestId("status").textContent).toBe("checking");
  });

  it("navigates to /login if the check itself rejects — fail closed, not open", async () => {
    const check = vi.fn().mockRejectedValue(new Error("network down"));

    render(<Probe check={check} />);

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/login" }));
  });

  it("calls check exactly once even under React StrictMode's double-invoke", async () => {
    const check = vi.fn().mockResolvedValue(null);

    render(
      <StrictMode>
        <Probe check={check} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("ready"));
    expect(check).toHaveBeenCalledTimes(1);
  });
});

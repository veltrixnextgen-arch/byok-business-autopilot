import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const getBrainKeyStatus = vi.fn();
const connectBrainKey = vi.fn();
const getCeiling = vi.fn();
const setCeiling = vi.fn();

vi.mock("../lib/brainKeyClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/brainKeyClient")>("../lib/brainKeyClient");
  return {
    ...actual,
    getBrainKeyStatus: () => getBrainKeyStatus(),
    connectBrainKey: (provider: string, apiKey: string) => connectBrainKey(provider, apiKey),
    getCeiling: () => getCeiling(),
    setCeiling: (v: number) => setCeiling(v),
  };
});

import { BrainKeyRejectedError } from "../lib/brainKeyClient";
import { ConnectScreen } from "./ConnectScreen";

afterEach(() => {
  cleanup();
  getBrainKeyStatus.mockReset();
  connectBrainKey.mockReset();
  getCeiling.mockReset();
  setCeiling.mockReset();
});

describe("ConnectScreen", () => {
  it("shows a connected summary immediately when a key is already connected and decryptable, skipping provider choice", async () => {
    getBrainKeyStatus.mockResolvedValue({
      id: "key-1",
      provider: "anthropic",
      maskedFingerprint: "sk-...4f2a",
      createdAt: new Date().toISOString(),
      decryptable: true,
    });

    render(<ConnectScreen />);

    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(screen.getByText("sk-...4f2a")).toBeTruthy();
    expect(screen.queryByText("Anthropic (Claude)")).toBeTruthy(); // provider label shown in the summary
  });

  // ADR-031: a connected-but-undecryptable key (a rotated KMS master key,
  // most likely) has nothing useful for the passive "you're all set"
  // summary to say — this must go straight to picking a provider and
  // pasting a fresh key, exactly like never having connected one, rather
  // than showing a misleading "Connected" card.
  it("skips straight to provider choice (not the connected summary) when the key is connected but not decryptable", async () => {
    getBrainKeyStatus.mockResolvedValue({
      id: "key-1",
      provider: "anthropic",
      maskedFingerprint: "sk-...4f2a",
      createdAt: new Date().toISOString(),
      decryptable: false,
    });

    render(<ConnectScreen />);

    expect(await screen.findByText("Before you paste anything")).toBeTruthy();
    expect(screen.queryByText("sk-...4f2a")).toBeNull();
  });

  it("walks provider choice -> walkthrough -> connect -> ceiling -> spend-cap -> done", async () => {
    getBrainKeyStatus.mockResolvedValue(null);
    connectBrainKey.mockResolvedValue({
      id: "key-1",
      provider: "anthropic",
      maskedFingerprint: "sk-...4f2a",
      createdAt: new Date().toISOString(),
    });
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: false });
    setCeiling.mockResolvedValue({ companyMonthlyUsd: 75, isOverride: true });

    render(<ConnectScreen />);

    // Provider choice
    const anthropicCard = await screen.findByText("Anthropic (Claude)");
    fireEvent.click(anthropicCard);

    // Walkthrough — steps and the "open console" link render
    expect(await screen.findByText(/Open console\.anthropic\.com/)).toBeTruthy();
    const keyInput = screen.getByLabelText("Paste your API key");
    fireEvent.change(keyInput, { target: { value: "sk-ant-real-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate & Connect" }));

    await waitFor(() => expect(connectBrainKey).toHaveBeenCalledWith("anthropic", "sk-ant-real-key"));

    // Ceiling step — prefilled from getCeiling
    const ceilingInput = (await screen.findByLabelText("Monthly ceiling (USD)")) as HTMLInputElement;
    await waitFor(() => expect(ceilingInput.value).toBe("50"));
    fireEvent.change(ceilingInput, { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));

    await waitFor(() => expect(setCeiling).toHaveBeenCalledWith(75));

    // Spend-cap step
    expect(await screen.findByText(/Set a spend cap on Anthropic \(Claude\)'s own site/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I've set my cap — finish" }));

    // Done
    expect(await screen.findByText("You're all set.")).toBeTruthy();
  });

  it("shows the provider's rejection message inline and does not advance past the walkthrough", async () => {
    getBrainKeyStatus.mockResolvedValue(null);
    connectBrainKey.mockRejectedValue(new BrainKeyRejectedError("That key didn't validate with the provider."));

    render(<ConnectScreen />);

    fireEvent.click(await screen.findByText("Anthropic (Claude)"));
    fireEvent.change(await screen.findByLabelText("Paste your API key"), { target: { value: "sk-ant-bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate & Connect" }));

    expect(await screen.findByText("That key didn't validate with the provider.")).toBeTruthy();
    expect(screen.getByLabelText("Paste your API key")).toBeTruthy(); // still on the walkthrough step
  });

  it("gates the skip button behind the 'I understand the risk' checkbox", async () => {
    getBrainKeyStatus.mockResolvedValue(null);
    connectBrainKey.mockResolvedValue({
      id: "key-1",
      provider: "anthropic",
      maskedFingerprint: "sk-...4f2a",
      createdAt: new Date().toISOString(),
    });
    getCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: false });
    setCeiling.mockResolvedValue({ companyMonthlyUsd: 50, isOverride: true });

    render(<ConnectScreen />);

    fireEvent.click(await screen.findByText("Anthropic (Claude)"));
    fireEvent.change(await screen.findByLabelText("Paste your API key"), { target: { value: "sk-ant-real-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate & Connect" }));

    const ceilingInput = (await screen.findByLabelText("Monthly ceiling (USD)")) as HTMLInputElement;
    await waitFor(() => expect(ceilingInput.value).toBe("50"));
    fireEvent.click(screen.getByRole("button", { name: "Save & continue" }));

    const skipButton = await screen.findByRole("button", { name: "Skip for now" });
    expect(skipButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(skipButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(skipButton);
    expect(await screen.findByText("You're all set.")).toBeTruthy();
  });

  it("shows advanced options (DeepSeek) only after the user asks for them", async () => {
    getBrainKeyStatus.mockResolvedValue(null);

    render(<ConnectScreen />);

    await screen.findByText("Anthropic (Claude)");
    expect(screen.queryByText("DeepSeek")).toBeNull();

    fireEvent.click(screen.getByText("Show advanced options (DeepSeek)"));
    expect(await screen.findByText("DeepSeek")).toBeTruthy();
  });
});

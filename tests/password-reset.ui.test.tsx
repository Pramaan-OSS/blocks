// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PasswordPanel } from "@/components/pramaan/password-reset/password-panel";

beforeEach(() => { window.history.replaceState(null, "", "/password-reset"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("3: collects a fresh bot-check token for each public request and redemption", async () => {
  const getBotCheckToken = vi.fn().mockResolvedValueOnce("fresh-request").mockResolvedValueOnce("fresh-reset");
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "Saved." }) }); vi.stubGlobal("fetch", fetcher);
  const page = render(<PasswordPanel getBotCheckToken={getBotCheckToken} />);
  await userEvent.type(screen.getByLabelText("Email", { exact: true }), "sam@example.com");
  await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "request", botCheckToken: "fresh-request" });
  page.unmount(); window.history.replaceState(null, "", "/password-reset#token=sample-proof");
  render(<PasswordPanel getBotCheckToken={getBotCheckToken} />);
  const reset = within(await screen.findByRole("region", { name: "Choose a new password" }));
  await userEvent.type(reset.getByLabelText("New password", { exact: true }), "A new password long enough");
  await userEvent.type(reset.getByLabelText("Confirm new password"), "A new password long enough");
  await userEvent.click(reset.getByRole("button", { name: "Save password" }));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "reset", botCheckToken: "fresh-reset" });
  expect(getBotCheckToken).toHaveBeenCalledTimes(2);
});

it("10: successful signed-in changes say to sign in again, without offering another reset link", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "Your password has been changed. Sign in with your new password." }) }));
  render(<PasswordPanel />);
  const change = within(screen.getByRole("region", { name: "Change your password" }));
  await userEvent.type(change.getByLabelText("Current password"), "The old password");
  await userEvent.type(change.getByLabelText("New password", { exact: true }), "The new password long enough");
  await userEvent.type(change.getByLabelText("Confirm new password"), "The new password long enough");
  await userEvent.click(change.getByRole("button", { name: "Save password" }));
  expect(await change.findByRole("status")).toBeTruthy();
  expect(change.queryByRole("link", { name: "Request another link" })).toBeNull();
});

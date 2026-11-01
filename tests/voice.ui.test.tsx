// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceCall } from "@/components/pramaan/voice/voice-call";
import { decideElsewhere, fakeState, resetFake } from "@/lib/pramaan/fake";
import { FAKE_BUSY_NUMBER } from "@/lib/pramaan/fake-wave3";
import { appFetch, useClock } from "./harness";

let clock: ReturnType<typeof useClock>;
beforeEach(() => {
  vi.stubEnv("APP_URL", "https://app.test");
  localStorage.clear();
  resetFake();
  clock = useClock(fakeState(), 1_000);
  vi.stubGlobal("fetch", appFetch());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const typeNumber = async (to: string) => userEvent.type(await screen.findByLabelText("Phone number"), to);
const dial = async (to: string) => {
  await typeNumber(to);
  await userEvent.click(screen.getByRole("button", { name: "Call" }));
};
const approve = () => decideElsewhere([...fakeState().approvals.keys()].at(-1)!, "approved");
const number = () => (screen.getByLabelText("Phone number") as HTMLInputElement).value;

describe("VoiceCall dialler", () => {
  it("starts as a dialler: a number box, twelve keys with letters, the line, and a Call button", async () => {
    render(<VoiceCall pollMs={20} />);
    await screen.findByLabelText("Phone number");
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]) expect(screen.getByRole("button", { name: k })).toBeTruthy();
    expect(screen.getByText("ABC")).toBeTruthy();
    expect(screen.getByText("WXYZ")).toBeTruthy();
    expect(screen.getByText("Demo stand-in")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Call" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Calls you make from here show up in this list.")).toBeTruthy();
  });

  it("the keypad types and backspace deletes; typing and pasting any layout also work", async () => {
    render(<VoiceCall pollMs={20} />);
    await screen.findByLabelText("Phone number");
    for (const k of ["4", "1", "5", "5", "5", "5"]) await userEvent.click(screen.getByRole("button", { name: k }));
    expect(number()).toBe("415 555");
    await userEvent.click(screen.getByRole("button", { name: "Delete last digit" }));
    expect(number()).toBe("415 55");
    await userEvent.clear(screen.getByLabelText("Phone number"));
    await userEvent.click(screen.getByLabelText("Phone number"));
    await userEvent.paste("+1 (415) 555-0100");
    expect(number()).toBe("+1 415 555 0100");
    expect(screen.queryByText(/Start with \+/)).toBeNull();
  });

  it("asks for the country code when the number has none", async () => {
    render(<VoiceCall pollMs={20} />);
    await typeNumber("4155550100");
    expect(screen.getByText("Start with + and the country code, like +1.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Call" }));
    expect(await screen.findByText(/Enter the phone number with its country code/)).toBeTruthy();
  });

  it("waits for a yes, then calls, connects with a timer, and hangs up into recent calls", async () => {
    render(<VoiceCall pollMs={20} />);
    await dial("+14155550100");
    expect(await screen.findByText("Waiting for a yes before the call starts.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the approvals inbox" }).getAttribute("href")).toBe("/");
    expect(screen.queryByRole("button", { name: "Call" })).toBeNull();

    act(() => approve());
    expect(await screen.findByText("Calling")).toBeTruthy();
    expect(screen.getByText("+1 415 555 0100")).toBeTruthy();
    act(() => void clock.advance(1_500));
    expect(await screen.findByText("Connected")).toBeTruthy();
    expect(await screen.findByLabelText("Time on the call")).toBeTruthy();
    // Only what the API can do: mute and hang up. No keypad or hold button in a call.
    expect(screen.getByRole("button", { name: "Mute" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /keypad|hold/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(screen.getByRole("button", { name: "Unmute" }).getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "Hang up" }));
    expect(await screen.findByText("Call ended")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hang up" })).toBeNull();
    const row = within(await screen.findByRole("list", { name: "Recent calls" })).getAllByRole("listitem")[0];
    expect(row.textContent).toMatch(/\+1 415 555 0100/);
    expect(row.textContent).toMatch(/Outgoing/);
    expect(row.textContent).toMatch(/Answered/);
    expect(within(row).getByRole("button", { name: "Call back +1 415 555 0100" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/ref_FAKE|cred_|ve_\d/);
  });

  it("says why a call didn't go through, and lists it as missed", async () => {
    render(<VoiceCall pollMs={20} />);
    await dial(FAKE_BUSY_NUMBER);
    await screen.findByText("Waiting for a yes before the call starts.");
    act(() => approve());
    await screen.findByText("Calling");
    act(() => void clock.advance(1_500));
    expect(await screen.findByText("The call didn't go through. The line was busy.")).toBeTruthy();
    const row = within(await screen.findByRole("list", { name: "Recent calls" })).getAllByRole("listitem")[0];
    expect(row.textContent).toMatch(/Busy/);
    expect(row.textContent).toMatch(/No talk time/);
  });

  it("calls back in one click from the recent list, still waiting for a yes", async () => {
    localStorage.setItem("pramaan-voice-recent", JSON.stringify([{ id: "c1", direction: "out", number: "+14155550100", at: new Date().toISOString(), seconds: 42, outcome: "Answered", missed: false }]));
    render(<VoiceCall pollMs={20} />);
    expect((await screen.findByRole("list", { name: "Recent calls" })).textContent).toMatch(/0:42/);
    await userEvent.click(screen.getByRole("button", { name: "Call back +1 415 555 0100" }));
    expect(await screen.findByText("Waiting for a yes before the call starts.")).toBeTruthy();
    expect(fakeState().requests.some((r) => r.path.endsWith("voice.browser-call.start"))).toBe(true);
  });

  it("offers a picker when there are several lines, and opens the phone on the one chosen", async () => {
    render(<VoiceCall pollMs={20} />);
    await userEvent.selectOptions(await screen.findByLabelText("Calling from"), "+442071838750");
    await dial("+14155550100");
    await screen.findByText("Waiting for a yes before the call starts.");
    const created = fakeState().requests.filter((r) => r.path.endsWith("voice.browser-session.create"));
    expect(created.at(-1)?.body).toMatchObject({ from: "+442071838750" });
  });

  it("signed out shows the shared plain state", async () => {
    vi.stubGlobal("fetch", appFetch("none"));
    render(<VoiceCall pollMs={20} />);
    expect(await screen.findByText("Sign in to see this.")).toBeTruthy();
    expect(screen.getByText("You need to be signed in to make calls.")).toBeTruthy();
  });

  describe("with a real microphone (stand-in off)", () => {
    it("a blocked microphone says so, and no phone connection is made", async () => {
      const connectPhone = vi.fn();
      render(<VoiceCall standIn={false} getMic={() => Promise.reject(new Error("denied"))} connectPhone={connectPhone} />);
      await dial("+14155550100");
      expect(await screen.findByText(/The microphone is blocked/)).toBeTruthy();
      expect(connectPhone).not.toHaveBeenCalled();
      expect(fakeState().requests.some((r) => r.path.endsWith("voice.browser-call.start"))).toBe(false);
      expect(screen.queryByText("Demo stand-in")).toBeNull();
    });

    it("connects with the session credential, never the API key", async () => {
      class Ctx {
        currentTime = 0;
        destination = {};
        createMediaStreamSource = () => ({ connect() {} });
        createScriptProcessor = () => ({ connect() {}, onaudioprocess: null });
        close = async () => {};
      }
      vi.stubGlobal("AudioContext", Ctx);
      const close = vi.fn();
      const connectPhone = vi.fn(() => ({ close, mute() {}, sendAudio() {}, setCredential() {}, cursor: undefined }));
      render(<VoiceCall standIn={false} getMic={async () => ({ getTracks: () => [] }) as unknown as MediaStream} connectPhone={connectPhone as never} />);
      await dial("+14155550100");
      await waitFor(() => expect(connectPhone).toHaveBeenCalledTimes(1));
      const opts = (connectPhone.mock.calls[0] as unknown as [{ connectUrl: string; credential: string }])[0];
      expect(opts.credential).toMatch(/^cred_/);
      expect(opts.connectUrl).toMatch(/^wss:\/\//);
      expect(JSON.stringify(opts)).not.toContain("fake\"");
      cleanup();
      expect(close).toHaveBeenCalled();
    });
  });
});

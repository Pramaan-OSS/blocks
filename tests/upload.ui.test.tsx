// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadDropzone, UploadedFiles } from "@/components/pramaan/upload/uploader";
import { fakeState, resetFake } from "@/lib/pramaan/fake";
import { storeFakeUpload } from "@/lib/pramaan/fake-wave3";
import { appFetch } from "./harness";

// A stand-in for the browser's XMLHttpRequest that hands the bytes to the fake storage and reports progress.
let refuse = false;
let short = false;
class FakeXhr {
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 0;
  onload?: () => void;
  onerror?: () => void;
  private url = "";
  open(_method: string, url: string) { this.url = url; }
  setRequestHeader() {}
  send(file: File) {
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: file.size / 2, total: file.size });
      if (refuse) { this.status = 403; return this.onload?.(); }
      storeFakeUpload(fakeState(), this.url.split("/").pop()!, new Uint8Array(short ? file.size - 1 : file.size));
      this.status = 200;
      this.onload?.();
    });
  }
}

beforeEach(() => {
  resetFake();
  refuse = false;
  short = false;
  sessionStorage.clear();
  vi.stubGlobal("fetch", appFetch());
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const pdf = (name = "contract.pdf", bytes = "hello") => new File([bytes], name, { type: "application/pdf" });

describe("UploadDropzone", () => {
  it("uploads a chosen file, reports it, and shows it in the list with its name", async () => {
    const got = vi.fn();
    render(<><UploadDropzone onUploaded={got} /><UploadedFiles pollMs={50} /></>);
    expect(await screen.findByText("No files yet")).toBeTruthy();
    await userEvent.upload(screen.getByLabelText("Choose files"), pdf());
    const row = (await screen.findByRole("list", { name: "Uploads" })).querySelector("li")!;
    await waitFor(() => expect(within(row).getByText("Uploaded")).toBeTruthy());
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ filename: "contract.pdf", sizeBytes: 5, fileId: expect.stringMatching(/^file_/) }));
    const files = await screen.findByRole("list", { name: "Files" });
    expect(within(files).getByText("contract.pdf")).toBeTruthy();
    expect(within(files).getByText(/PDF document · 5 B/)).toBeTruthy();
  });

  it("shows the server's own words for a file it won't take, then retries after a refused send", async () => {
    render(<UploadDropzone />);
    await userEvent.upload(screen.getByLabelText("Choose files"), new File(["x"], "a.zip", { type: "application/zip" }), { applyAccept: false });
    expect(await screen.findByText(/isn't supported/)).toBeTruthy();
    cleanup();

    refuse = true;
    render(<UploadDropzone />);
    await userEvent.upload(screen.getByLabelText("Choose files"), pdf());
    expect(await screen.findByText("The upload didn't go through. Try again.")).toBeTruthy();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Try contract.pdf again" }));
    expect(await screen.findByText("Uploaded")).toBeTruthy();
  });

  it("says plainly when the check fails", async () => {
    short = true;
    render(<UploadDropzone />);
    await userEvent.upload(screen.getByLabelText("Choose files"), pdf());
    expect(await screen.findByText("The file didn't arrive in full. Start a new upload.")).toBeTruthy();
    expect(screen.getByText("Didn't upload")).toBeTruthy();
  });
});

describe("UploadedFiles", () => {
  it("deletes a file after asking", async () => {
    render(<><UploadDropzone /><UploadedFiles pollMs={50} /></>);
    await userEvent.upload(screen.getByLabelText("Choose files"), pdf());
    await userEvent.click(await screen.findByRole("button", { name: "Delete contract.pdf" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("contract.pdf was deleted.")).toBeTruthy();
    expect(await screen.findByText("No files yet")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/file_FAKE/);
  });
});

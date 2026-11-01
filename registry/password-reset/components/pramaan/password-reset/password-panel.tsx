"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PasswordPanelProps = { getBotCheckToken?: () => Promise<string> };
export function PasswordPanel({ getBotCheckToken }: PasswordPanelProps) {
  const [token, setToken] = useState("");
  useEffect(() => {
    const readLink = () => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
      if (value) {
        setToken(value);
        // The proof stays out of server request logs, referrers and the browser's current address.
        window.history.replaceState(null, "", window.location.pathname);
      }
    };
    readLink();
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);
  return <div className="max-w-xl space-y-6">
    {token ? <PasswordForm key={token} action="reset" token={token} getBotCheckToken={getBotCheckToken} /> : <PasswordForm action="request" getBotCheckToken={getBotCheckToken} />}
    <PasswordForm action="change" />
  </div>;
}

function PasswordForm({ action, token, getBotCheckToken }: { action: "request" | "reset" | "change"; token?: string } & PasswordPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const title = action === "request" ? "Forgot your password?" : action === "reset" ? "Choose a new password" : "Change your password";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    if (action !== "request" && values.password !== values.confirmPassword) {
      setFailed(true); setMessage("The new passwords do not match."); return;
    }
    setBusy(true); setMessage("");
    try {
      const botCheckToken = action === "change" ? undefined : await getBotCheckToken?.();
      const response = await fetch("/api/pramaan/password-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, action, token, botCheckToken }) });
      const body = await response.json();
      setFailed(!response.ok);
      setMessage(typeof body.message === "string" ? body.message : "Please try again later.");
      if (response.ok) { form.reset(); if (action !== "request") setDone(true); }
    } catch { setFailed(true); setMessage("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  return <section aria-label={title} className="pr-card space-y-3">
    <h2>{title}</h2>
    <p className="text-sm text-muted-foreground">{action === "request" ? "Enter your email and we will send a link to choose a new password." : action === "reset" ? "Use at least 12 characters. Your link works once for 30 minutes." : "Sign in first, then enter your current password. You will sign in again after changing it."}</p>
    <form onSubmit={submit} className="space-y-3">
      {action === "request" ? <div className="space-y-1"><Label htmlFor={`${action}-email`}>Email</Label><Input id={`${action}-email`} name="email" type="email" autoComplete="email" maxLength={254} required /></div> : <>
        {action === "change" && <div className="space-y-1"><Label htmlFor="current-password">Current password</Label><Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" maxLength={1024} required /></div>}
        <div className="space-y-1"><Label htmlFor={`${action}-password`}>New password</Label><Input id={`${action}-password`} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required /></div>
        <div className="space-y-1"><Label htmlFor={`${action}-confirm`}>Confirm new password</Label><Input id={`${action}-confirm`} name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required /></div>
      </>}
      <Button type="submit" disabled={busy || done}>{busy ? "Please wait…" : action === "request" ? "Send reset link" : "Save password"}</Button>
      {message && <p role={failed ? "alert" : "status"} className="text-sm">{message}</p>}
    </form>
    {done && action === "reset" && <a className="pr-link text-sm" href="/password-reset">Request another link</a>}
  </section>;
}

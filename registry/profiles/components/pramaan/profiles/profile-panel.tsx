"use client";
import { useState, type FormEvent } from "react";
import { api, useResource } from "@/lib/pramaan/client";
import { Button } from "@/components/ui/button";
import type { Profile } from "@/lib/pramaan/profiles";
import type { UploadLink } from "@/lib/pramaan/upload";
const field = "block w-full rounded border bg-background p-2";
type PublicProfile = { name?: string; bio?: string; links?: string[]; photoUrl?: string };
export function PublicProfilePanel({ person }: { person: string }) {
  const { data, error, loading, reload } = useResource<PublicProfile>(`/api/pramaan/profiles?person=${encodeURIComponent(person)}`);
  if (loading) return <p role="status">Loading profile…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  return <article aria-label="Public profile" className="space-y-4 rounded border p-6">
    {data?.photoUrl && <img src={data.photoUrl} alt="Profile photo" width={96} height={96} className="rounded-full object-cover" />}
    <h2 className="font-serif text-2xl">{data?.name || "Community member"}</h2>
    {data?.bio && <p>{data.bio}</p>}
    <ul>{data?.links?.map((url, i) => <li key={url}><a className="underline" href={url} rel="nofollow noreferrer">Visit link {i + 1}</a></li>)}</ul>
  </article>;
}
export function ProfilePanel({ getBotCheckToken }: { getBotCheckToken?: () => Promise<string> } = {}) {
  const { data, error, loading, reload } = useResource<Profile>("/api/pramaan/profiles");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function post(body: unknown) {
    return api<Profile & UploadLink>("/api/pramaan/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(body as object), botCheckToken: await getBotCheckToken?.() }) });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!data || busy) return;
    const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      await post({ revision: data.revision, name: form.get("name"), bio: form.get("bio"), links: String(form.get("links")).split("\n").map(s => s.trim()).filter(Boolean), public: Object.fromEntries(["name", "bio", "links", "photo"].map(k => [k, form.get(`public-${k}`) === "on"])) });
      reload(); setMessage("Profile saved.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't save. Try again."); }
    finally { setBusy(false); }
  }
  async function photo(file?: File) {
    if (!file || busy) return; setBusy(true); setMessage("");
    try {
      const link = await post({ action: "photo-start", contentType: file.type, sizeBytes: file.size });
      const response = await fetch(link.uploadUrl, { method: "PUT", headers: link.headers, body: file });
      if (!response.ok) throw new Error("The photo didn't upload. Try again.");
      await post({ action: "photo-finish", fileId: link.fileId }); reload(); setMessage("Photo uploaded.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Couldn't upload. Try again."); reload(); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Loading your profile…</p>;
  if (error) return <div role="alert">{error.message} <Button variant="outline" onClick={reload}>Try again</Button></div>;
  if (!data) return null;
  return <div className="space-y-6 max-w-xl">
    <p>Choose what visitors can see. All fields start private.</p>
    <form key={data.revision} onSubmit={save} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block">Display name<input required maxLength={100} className={field} name="name" defaultValue={data.name} /></label>
        <label className="block">Short bio<textarea maxLength={500} className={field} name="bio" defaultValue={data.bio} /></label>
        <label className="block">Links, one per line<textarea className={field} name="links" defaultValue={data.links.join("\n")} /></label>
        <fieldset className="space-y-2"><legend>Show on your public page</legend>{([['name', 'Display name'], ['bio', 'Short bio'], ['links', 'Links'], ['photo', 'Photo']] as const).map(([key, label]) => <label key={key} className="block"><input type="checkbox" name={`public-${key}`} defaultChecked={data.public[key]} /> {label}</label>)}</fieldset>
        <Button type="submit">Save profile</Button>
      </fieldset>
    </form>
    <label className="block">Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className={field} onChange={event => { void photo(event.target.files?.[0]); event.target.value = ""; }} /></label>
    <p className="text-sm text-muted-foreground">PNG, JPEG or WebP, up to 5 MB. Photos stay private until you choose to show them.</p>
    <p role="status" aria-live="polite">{message}</p>
    <a className="underline" href={`/profiles/${encodeURIComponent(data.person)}`}>View public page</a>
  </div>;
}

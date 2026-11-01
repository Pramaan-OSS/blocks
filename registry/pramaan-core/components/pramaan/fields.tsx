"use client";

import { useState } from "react";
import { fieldLabel, looksLikeId } from "@/lib/pramaan/plain";

/** A small control that copies an id to the clipboard without showing it. */
export function CopyReference({ value, label = "Copy reference" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="pr-link"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2_000);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") return <>(empty)</>;
  if (typeof value === "boolean") return <>{value ? "Yes" : "No"}</>;
  if (looksLikeId(value)) return <CopyReference value={value} />;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) return <>{value.map((v) => (looksLikeId(v) ? "a reference" : String(v))).join(", ")}</>;
    return (
      <ol className="space-y-2">
        {value.map((v, i) => (
          <li key={i}>{typeof v === "object" && v !== null ? <Fields input={v} nested /> : <Value value={v} />}</li>
        ))}
      </ol>
    );
  }
  if (typeof value === "object") return <Fields input={value} nested />;
  return <>{String(value)}</>;
}

function Fields({ input, nested = false, label }: { input: object; nested?: boolean; label?: string }) {
  const entries = Object.entries(input);
  return (
    <dl aria-label={label} className={nested ? "space-y-1 text-sm" : "pr-fields"}>
      {entries.map(([key, value]) => (
        <div key={key} className="pr-field">
          <dt>{fieldLabel(key)}</dt>
          <dd>
            <Value value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * An object as plain labelled lines, exactly as it will be used or was returned: no JSON, no key
 * names, ids behind a Copy reference control. Nested objects and lists indent.
 */
export function InputFields({ input, label = "Details", empty = "No details were sent with this request." }: { input: unknown; label?: string; empty?: string }) {
  if (input === null || input === undefined || typeof input !== "object" || Object.keys(input).length === 0) {
    if (input !== null && input !== undefined && typeof input !== "object")
      return <p className="text-sm">{String(input)}</p>;
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return <Fields input={input} label={label} />;
}

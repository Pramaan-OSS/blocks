"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { JsonSchema } from "@/lib/pramaan/json-schema";
import { fieldLabel } from "@/lib/pramaan/plain";

// A start form built from a mission's input JSON Schema: text, long text, number, yes/no, a choice,
// a list (one item per line), and JSON for anything nested. Required fields are marked and checked.

export type FormValues = Record<string, string | boolean>;

type Kind = "choice" | "boolean" | "number" | "lines" | "json" | "text" | "longtext";

const typeOf = (s: JsonSchema) => (Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type);

export function fieldKind(s: JsonSchema): Kind {
  if (s.enum) return "choice";
  const t = typeOf(s);
  if (t === "boolean") return "boolean";
  if (t === "number" || t === "integer") return "number";
  if (t === "array" && typeOf(s.items ?? {}) === "string") return "lines";
  if (t === "array" || t === "object") return "json";
  return (s.maxLength ?? 0) > 300 ? "longtext" : "text";
}

// The same plain labels as everywhere else: "text" is "Message", "to" is "To".
const humanize = fieldLabel;

/** The input the form describes, typed, plus a message for each field that is wrong. */
export function buildInput(schema: JsonSchema, values: FormValues): { input: Record<string, unknown>; errors: Record<string, string> } {
  const input: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, field] of Object.entries(schema.properties ?? {})) {
    const raw = values[key];
    const label = humanize(key);
    const kind = fieldKind(field);
    if (kind === "boolean") {
      if (raw === true || (raw === false && required.has(key))) input[key] = raw;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (required.has(key)) errors[key] = `${label} is required.`;
      continue;
    }
    if (kind === "number") {
      const n = Number(text);
      if (Number.isNaN(n)) errors[key] = `${label} must be a number.`;
      else if (field.minimum !== undefined && n < field.minimum) errors[key] = `${label} must be at least ${field.minimum}.`;
      else if (field.maximum !== undefined && n > field.maximum) errors[key] = `${label} must be at most ${field.maximum}.`;
      else input[key] = n;
    } else if (kind === "lines") {
      input[key] = text.split("\n").map((x) => x.trim()).filter(Boolean);
    } else if (kind === "json") {
      try {
        input[key] = JSON.parse(text);
      } catch {
        errors[key] = `${label} must be valid JSON.`;
      }
    } else if (field.maxLength !== undefined && text.length > field.maxLength) {
      errors[key] = `${label} must be at most ${field.maxLength} characters.`;
    } else input[key] = text;
  }
  return { input, errors };
}

export function SchemaForm({
  schema,
  values,
  onChange,
  errors = {},
  disabled,
}: {
  schema: JsonSchema;
  values: FormValues;
  onChange: (values: FormValues) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const id = useId();
  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties ?? {});
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">This mission needs no input.</p>;
  return (
    <div className="space-y-4">
      {entries.map(([key, field]) => {
        const fid = `${id}-${key}`;
        const kind = fieldKind(field);
        const set = (v: string | boolean) => onChange({ ...values, [key]: v });
        const hint = field.description ? `${fid}-hint` : undefined;
        const err = errors[key] ? `${fid}-err` : undefined;
        const common = { id: fid, disabled, "aria-invalid": errors[key] ? true : undefined, "aria-describedby": [hint, err].filter(Boolean).join(" ") || undefined };
        const value = typeof values[key] === "string" ? (values[key] as string) : "";
        return (
          <div key={key} className="space-y-1.5">
            {kind === "boolean" ? (
              <div className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-primary" {...common} checked={values[key] === true} onChange={(e) => set(e.target.checked)} />
                <Label htmlFor={fid}>{humanize(key)}</Label>
              </div>
            ) : (
              <Label htmlFor={fid}>
                {humanize(key)}
                {required.has(key) && <span aria-hidden> *</span>}
                {required.has(key) && <span className="sr-only"> (required)</span>}
              </Label>
            )}
            {kind === "choice" && (
              <select
                {...common}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="pr-select"
              >
                <option value="">Choose…</option>
                {field.enum!.map((o) => (
                  <option key={String(o)} value={String(o)}>
                    {String(o)}
                  </option>
                ))}
              </select>
            )}
            {(kind === "text" || kind === "number") && (
              <Input {...common} type={kind === "number" ? "number" : "text"} value={value} onChange={(e) => set(e.target.value)} />
            )}
            {(kind === "longtext" || kind === "lines" || kind === "json") && (
              <Textarea {...common} rows={kind === "longtext" ? 5 : 3} value={value} onChange={(e) => set(e.target.value)} className={kind === "json" ? "font-mono" : undefined} />
            )}
            {kind === "lines" && <p className="text-xs text-muted-foreground">One per line.</p>}
            {kind === "json" && <p className="text-xs text-muted-foreground">JSON.</p>}
            {field.description && (
              <p id={hint} className="text-xs text-muted-foreground">
                {field.description}
              </p>
            )}
            {errors[key] && (
              <p id={err} role="alert" className="text-xs text-destructive">
                {errors[key]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

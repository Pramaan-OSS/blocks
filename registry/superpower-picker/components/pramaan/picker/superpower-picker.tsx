"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmAction } from "@/components/pramaan/confirm-action";
import { InputFields } from "@/components/pramaan/fields";
import { StatusPill } from "@/components/pramaan/parts";
import { buildInput, type FormValues, SchemaForm } from "@/components/pramaan/schema-form";
import { EmptyState, ErrorState, LoadingState, StatusMessage } from "@/components/pramaan/states";
import { ApiError, announceChange, api, useResource } from "@/lib/pramaan/client";
import type { Choice, Detail, Estimate, RunResult, SearchResult } from "@/lib/pramaan/picker";

const post = <T,>(url: string, body: unknown, headers: Record<string, string> = {}) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

function Pills({ c }: { c: Choice }) {
  return (
    <>
      <StatusPill tone={c.kind === "mission" ? "blue" : "grey"}>{c.kind === "mission" ? "Mission" : "Single action"}</StatusPill>
      {c.needsApproval && <StatusPill tone="amber">Needs a yes first</StatusPill>}
      {c.needsConnection && <StatusPill tone="amber">Needs a connected account</StatusPill>}
    </>
  );
}

function ChoiceDetail({ id, kind, approvalsHref, missionsHref, walletHref }: { id: string; kind: Choice["kind"]; approvalsHref: string; missionsHref: string; walletHref?: string }) {
  const d = useResource<Detail>(`/api/pramaan/picker/${encodeURIComponent(id)}?kind=${kind}`);
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [estimate, setEstimate] = useState<Estimate>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiError>();
  const [outcome, setOutcome] = useState<RunResult>();
  // One key per estimate: a repeat of the same click returns the first answer, never a second run.
  const key = useRef("");
  useEffect(() => {
    key.current = crypto.randomUUID();
  }, [estimate]);

  if (d.error && !d.data) return <ErrorState error={d.error} onRetry={d.reload} />;
  if (!d.data) return <LoadingState label="Loading" />;
  const c = d.data;

  async function getEstimate() {
    const built = buildInput(c.inputSchema, values);
    setErrors(built.errors);
    setProblem(undefined);
    setEstimate(undefined);
    setOutcome(undefined);
    if (Object.keys(built.errors).length) return;
    setBusy(true);
    try {
      setInput(built.input);
      setEstimate(await post<Estimate>(`/api/pramaan/picker/${encodeURIComponent(id)}/estimate`, { input: built.input }));
    } catch (e) {
      setProblem(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    try {
      setOutcome(await post<RunResult>(`/api/pramaan/picker/${encodeURIComponent(id)}/run`, { input }, { "Idempotency-Key": key.current }));
      announceChange();
    } catch (e) {
      setProblem(e as ApiError);
    }
  }

  return (
    <section aria-label="Details" className="pr-card space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2>{c.name}</h2>
        <Pills c={c} />
      </div>
      <p className="text-sm text-muted-foreground">{c.description}</p>


      {c.kind === "mission" ? (
        <>
          <ol aria-label="Steps" className="pr-rows">
            {c.steps?.map((s) => (
              <li key={s.label} className="pr-row text-sm">
                <span className="pr-row-main">
                  <b>{s.label}</b>
                  <span className="pr-row-sub">{s.needsApproval ? "Needs a person's yes" : ""}</span>
                </span>
              </li>
            ))}
          </ol>
          <a className="pr-btn pr-btn-primary" href={missionsHref}>
            Run it in Missions
          </a>
        </>
      ) : (
        <>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void getEstimate();
            }}
          >
            <SchemaForm schema={c.inputSchema} values={values} errors={errors} onChange={(v) => { setValues(v); setEstimate(undefined); setOutcome(undefined); }} />
            <Button type="submit" disabled={busy}>
              {busy ? "Checking…" : "Check before running"}
            </Button>
          </form>

          {problem && <ErrorState error={problem} walletHref={walletHref} />}

          {estimate && !outcome && (
            <section aria-label="Readiness" className="pr-sunk space-y-3">
              <p className="text-sm">{estimate.canRun ? "Ready to request." : "This cannot run yet."}</p>
              {!estimate.ready && <p role="alert" className="text-sm text-destructive">{estimate.message ?? "Something is still missing before this can run."}</p>}
              {estimate.topUp && <ErrorState error={new ApiError(estimate.topUp.message, "spend_cap_reached", undefined, 402, { ...estimate.topUp, links: [...estimate.topUp.links] })} walletHref={walletHref} />}
              <ConfirmAction
                label={c.needsApproval ? "Ask for a yes" : "Run it"}
                title={`${c.name}?`}
                description={c.needsApproval ? "It goes to the approvals inbox first and runs only after a yes." : "It runs once after you confirm."}
                details={<InputFields input={input} label="Exact inputs" empty="This needs no input." />}
                confirmLabel={c.needsApproval ? "Ask for a yes" : "Run it"}
                disabled={!estimate.ready || !estimate.canRun}
                onConfirm={run}
              />
            </section>
          )}

          {outcome?.status === "done" && (
            <section aria-label="Result" className="space-y-2">
              <h3>Result</h3>
              <InputFields input={outcome.result} label="What came back" empty="It ran and returned nothing to show." />
            </section>
          )}
          {outcome?.status === "running" && (
            <p role="status" className="pr-sunk text-sm">It's running. It shows in your activity once it finishes.</p>
          )}
          {outcome?.status === "waiting_for_approval" && (
            <p role="status" className="pr-sunk text-sm">
              Waiting for a yes. <a className="underline" href={approvalsHref}>Open the approvals inbox</a>; it runs once, after the decision.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Find an action or a mission in plain words, see what it costs, and run it from a form built from
 * its inputs. Actions that send something wait for a yes in the approvals inbox. A mission opens in
 * your missions screen (`missionsHref`).
 */
export function SuperpowerPicker({ approvalsHref = "/", missionsHref = "/missions", walletHref }: { approvalsHref?: string; missionsHref?: string; walletHref?: string }) {
  const field = useId();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Pick<Choice, "id" | "kind">>();
  const found = useResource<SearchResult>(`/api/pramaan/picker${q ? `?q=${encodeURIComponent(q)}` : ""}`);

  return (
    <div className="space-y-6">
      <form
        role="search"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(typed.trim());
          setPicked(undefined);
        }}
      >
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor={field}>What do you want to do?</Label>
          <Input id={field} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="For example: send a text message" />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-3">
          {found.error && !found.data ? (
            <ErrorState error={found.error} onRetry={found.reload} />
          ) : !found.data ? (
            <LoadingState label="Searching" />
          ) : (
            <>
              {found.data.clarify && (
                <section aria-label="A quick question" className="pr-card space-y-2">
                  <p className="font-medium">{found.data.clarify.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {found.data.clarify.options.map((o) => (
                      <Button key={o.id} variant="outline" size="sm" onClick={() => setPicked({ id: o.id, kind: "action" })}>
                        {o.label}
                      </Button>
                    ))}
                  </div>
                </section>
              )}
              {found.data.results.length === 0 ? (
                <EmptyState title="Nothing matches">
                  {found.data.missed ? `Nothing fits “${found.data.missed.join(" ")}”. ` : ""}Try other words, like what you want done.
                </EmptyState>
              ) : (
                <ul className="pr-rows" aria-label="Matches">
                  {found.data.results.map((c) => (
                    <li key={`${c.kind}:${c.id}`}>
                      <button type="button" className="pr-row" aria-pressed={picked?.id === c.id} onClick={() => setPicked({ id: c.id, kind: c.kind })}>
                        <span className="pr-row-main">
                          <b>{c.name}</b>
                          <span className="pr-row-sub">{c.description}</span>
                        </span>
                        <span className="pr-row-side">
                          <StatusPill tone={c.kind === "mission" ? "blue" : "grey"}>{c.kind === "mission" ? "Mission" : "Action"}</StatusPill>

                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {found.data.more && <p className="pr-meta">Showing the first {found.data.results.length}. Search to narrow them down.</p>}
            </>
          )}
        </div>
        <div>
          {picked ? (
            <ChoiceDetail key={`${picked.kind}:${picked.id}`} id={picked.id} kind={picked.kind} approvalsHref={approvalsHref} missionsHref={missionsHref} walletHref={walletHref} />
          ) : (
            <EmptyState title="Choose one">The questions it needs show here.</EmptyState>
          )}
        </div>
      </div>
      <StatusMessage text={found.data ? `${found.data.results.length} ${found.data.results.length === 1 ? "match" : "matches"}` : undefined} />
    </div>
  );
}

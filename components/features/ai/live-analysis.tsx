"use client";

import { useRef, useState } from "react";

import { ExtractionTable } from "@/components/features/intake/extraction-table";
import { VoiceNoteCard } from "@/components/features/intake/voice-note-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { Meter } from "@/components/ui/meter";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { formatConfidence, formatInr, formatMass, formatRate, lineValue } from "@/lib/format";
import { conditionTone, materialTone, verdictTone } from "@/lib/tone";
import type { AiAnalysis, AiIntakeResult } from "@/lib/ai/proposal";
import type { Verdict } from "@/lib/types";

/**
 * Capture, then the answer — the live half of all three AI features.
 *
 * One component serves valuation, intake and the gatekeeper because the input is
 * identical in all three cases and only the emphasis differs; three near-identical
 * screens would drift apart within a week.
 *
 * Two things it refuses to do. It never shows a rupee figure that did not come back
 * from the server, and it never presents a result without saying which model,
 * which inputs and how long — an AI number a reviewer cannot trace is worse than no
 * number at all.
 */

export type LiveMode = "valuation" | "intake" | "gatekeeper";

interface Media {
  mimeType: string;
  dataBase64: string;
  label: string;
}

interface GatekeeperDecision {
  id: string;
  subject: string;
  brand: string;
  cpcb: string;
  verdict: Verdict;
  creditable: boolean;
  confidence: number;
  matchedClass: string;
  ruleCode: string;
  reason: string;
  signals: { label: string; value: string }[];
  modelVersion: string;
  checkedAt: string;
  withheldCreditInr: number;
  creditNote: string;
  massGrams: number;
  hazardous: boolean;
  warnings: string[];
  source: AiAnalysis["source"];
}

interface Failure {
  code: string;
  message: string;
  issues?: string[];
}

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
/**
 * 3 MB, not 6.
 *
 * A bigger clip passed this check and then died on the way out: the hosting layer
 * caps one request at roughly 6 MiB, base64 adds a third on top of the file, and a
 * 6 MB recording encodes to 8 MB — a guaranteed failure that reached the operator as
 * a bare HTTP 413 the server never produced.
 */
const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

/**
 * Both attachments together, in base64 characters.
 *
 * The per-file limits above each fit alone, but the pair has to fit in one request,
 * so they are bounded again here. Mirrors `MAX_TOTAL_CHARS` in `lib/ai/http.ts`.
 */
const MAX_TOTAL_CHARS = 5_500_000;

const ENDPOINTS: Record<LiveMode, string> = {
  valuation: "/api/ai/valuation",
  intake: "/api/ai/intake",
  gatekeeper: "/api/ai/gatekeeper",
};

const COPY: Record<LiveMode, { caption: string; action: string; body: string }> = {
  valuation: {
    caption: "Live valuation",
    action: "Value this item",
    body: "Photograph the item and it is identified, assayed into material fractions and priced off the same rate card the sample records use. Add a note if the collector has already weighed it.",
  },
  intake: {
    caption: "Live intake",
    action: "Read this intake",
    body: "A photo, a voice note in Hindi, or both. The audio is read directly — no separate speech service — so the transcript, the extracted fields and the price come back together.",
  },
  gatekeeper: {
    caption: "Live gatekeeper",
    action: "Run the gatekeeper",
    body: "Point it at anything and it decides valid, held or rejected before a rupee is promised. Try a plastic bottle: nothing about this system is more important than it refusing to pay for one.",
  },
};

async function readFile(file: File): Promise<Media> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return {
    mimeType: file.type || "application/octet-stream",
    dataBase64: comma === -1 ? dataUrl : dataUrl.slice(comma + 1),
    label: file.name || "capture",
  };
}

/** Recording length, measured off the blob rather than inferred server-side. */
function measureAudio(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

export function LiveAnalysis({ mode }: { mode: LiveMode }) {
  const [photo, setPhoto] = useState<Media | null>(null);
  const [audio, setAudio] = useState<Media | null>(null);
  const [audioSeconds, setAudioSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [note, setNote] = useState("");
  const [declaredMass, setDeclaredMass] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [intake, setIntake] = useState<AiIntakeResult | null>(null);
  const [decision, setDecision] = useState<GatekeeperDecision | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  const copy = COPY[mode];
  const running = status === "running";
  const hasInput = Boolean(photo || audio || note.trim());

  function reset() {
    setPhoto(null);
    setAudio(null);
    setAudioSeconds(0);
    setNote("");
    setDeclaredMass("");
    setAnalysis(null);
    setIntake(null);
    setDecision(null);
    setFailure(null);
    setStatus("idle");
    if (photoInput.current) photoInput.current.value = "";
    if (audioInput.current) audioInput.current.value = "";
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setFailure({
        code: "payload_too_large",
        message: `That photo is ${Math.round(file.size / 1024 / 1024)} MB. Keep it under 3 MB so the upload survives a patchy connection.`,
      });
      return;
    }
    setFailure(null);
    setPhoto(await readFile(file));
  }

  async function pickAudio(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) {
      setFailure({
        code: "payload_too_large",
        message: `That clip is ${Math.round(file.size / 1024 / 1024)} MB. Keep it under 3 MB — ten seconds of speech is plenty.`,
      });
      return;
    }
    setFailure(null);
    setAudio(await readFile(file));
    setAudioSeconds(await measureAudio(file));
  }

  async function toggleRecording() {
    if (recording) {
      recorder.current?.stop();
      setRecording(false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailure({
        code: "no_recorder",
        message: "This browser will not record audio. Attach a clip instead.",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const active = new MediaRecorder(stream);
      chunks.current = [];
      active.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      active.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: active.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        if (blob.size > MAX_AUDIO_BYTES) {
          setFailure({
            code: "payload_too_large",
            message: "That recording is over 3 MB. Keep it under about a minute.",
          });
          return;
        }
        const file = new File([blob], "voice-note.webm", {
          type: blob.type || "audio/webm",
        });
        setAudio(await readFile(file));
        setAudioSeconds(await measureAudio(blob));
      };
      recorder.current = active;
      active.start();
      setRecording(true);
      setFailure(null);
    } catch {
      setFailure({
        code: "mic_denied",
        message:
          "The microphone was refused. A collector can still attach a clip, and the note field works without either.",
      });
    }
  }

  async function run() {
    setStatus("running");
    setFailure(null);

    const body: Record<string, unknown> = {};
    if (photo) body.photo = { mimeType: photo.mimeType, dataBase64: photo.dataBase64 };
    if (audio) body.audio = { mimeType: audio.mimeType, dataBase64: audio.dataBase64 };
    if (note.trim()) body.note = note.trim();
    if (mode === "valuation" && Number(declaredMass) > 0) {
      body.declaredMassGrams = Number(declaredMass);
    }
    if (mode === "intake" && audioSeconds > 0) {
      body.durationSeconds = Math.round(audioSeconds);
    }

    // Refused here rather than upstream. The server checks the same total, but past
    // roughly 6 MiB the hosting layer answers 413 itself, so the request never
    // arrives and nothing on the server can explain what went wrong.
    const encodedChars =
      (photo?.dataBase64.length ?? 0) + (audio?.dataBase64.length ?? 0);
    if (encodedChars > MAX_TOTAL_CHARS) {
      setFailure({
        code: "payload_too_large",
        message: `The photo and the recording together are ${Math.round(encodedChars / 1024 / 1024)} MB encoded. One upload carries about 4 MB of file, so attach a shorter clip or send the photo on its own.`,
      });
      setStatus("idle");
      return;
    }

    try {
      const response = await fetch(ENDPOINTS[mode], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Record<string, unknown> & { error?: string; message?: string; issues?: string[] })
        | null;

      if (!response.ok || !payload) {
        setFailure({
          code: payload?.error ?? `http_${response.status}`,
          message:
            payload?.message ??
            "The request failed before the model answered. Nothing was credited.",
          issues: payload?.issues,
        });
        setStatus("idle");
        return;
      }

      if (mode === "intake") setIntake(payload as unknown as AiIntakeResult);
      else if (mode === "valuation") setAnalysis(payload as unknown as AiAnalysis);
      else setDecision(payload as unknown as GatekeeperDecision);
      setStatus("done");
    } catch {
      setFailure({
        code: "network",
        message: "The browser could not reach the server. Nothing was credited.",
      });
      setStatus("idle");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel
        eyebrow={copy.caption}
        title="Capture"
        actions={
          status === "done" ? (
            <Button variant="secondary" onClick={reset}>
              Clear
            </Button>
          ) : null
        }
      >
        <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">{copy.body}</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* photo */}
          <Surface tone="inset" className="flex flex-col gap-3 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              1 · Photo
            </p>
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={(event) => void pickPhoto(event.target.files?.[0])}
              className="block w-full border border-rule bg-paper px-3 py-2 font-mono text-[11px] text-ink file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.14em] file:text-paper"
            />
            <p className="text-[12px] leading-snug text-ink-muted">
              {photo ? (
                <>
                  <Badge tone="copper">Attached</Badge>{" "}
                  <span className="font-mono">{photo.label}</span>
                </>
              ) : (
                "JPEG, PNG, WebP or HEIC, up to 3 MB."
              )}
            </p>
          </Surface>

          {/* voice */}
          <Surface tone="inset" className="flex flex-col gap-3 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              2 · Voice note (Hindi)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={recording ? "danger" : "secondary"}
                onClick={() => void toggleRecording()}
                disabled={running}
              >
                {recording ? "Stop recording" : "Record"}
              </Button>
              <input
                ref={audioInput}
                type="file"
                accept="audio/webm,audio/ogg,audio/wav,audio/mpeg,audio/mp4"
                onChange={(event) => void pickAudio(event.target.files?.[0])}
                className="block max-w-[16rem] border border-rule bg-paper px-3 py-2 font-mono text-[11px] text-ink"
              />
            </div>
            <p className="text-[12px] leading-snug text-ink-muted">
              {audio ? (
                <>
                  <Badge tone="copper">Attached</Badge>{" "}
                  <span className="font-mono">
                    {audio.label}
                    {audioSeconds > 0 ? ` · ${Math.round(audioSeconds)} s` : ""}
                  </span>
                </>
              ) : (
                "The browser reads the audio directly, so nothing is transcribed twice."
              )}
            </p>
          </Surface>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              3 · What the collector said
            </span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="पुराना लैपटॉप मदरबोर्ड है, चलता नहीं — or type it in English."
              className="w-full border border-rule bg-paper-raised px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted focus:border-ink"
            />
          </label>

          {mode === "valuation" ? (
            <label className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                4 · Declared mass (g)
              </span>
              <input
                value={declaredMass}
                onChange={(event) => setDeclaredMass(event.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="412"
                className="w-full border border-rule bg-paper-raised px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink"
              />
              <span className="text-[12px] leading-snug text-ink-muted">
                Optional. If your estimate disagrees with it by more than 30%, the model is told to say so.
              </span>
            </label>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t-2 border-ink pt-4">
          <Button onClick={() => void run()} disabled={running || !hasInput}>
            {running ? "Analysing…" : copy.action}
          </Button>
          <span className="text-[12px] leading-snug text-ink-muted">
            {hasInput
              ? "The model names the materials; the rate card prices them on the server."
              : "Attach a photo, record a note, or describe the item."}
          </span>
        </div>

        {failure ? (
          <div className="mt-4 border-2 border-hazard bg-hazard-tint p-4">
            <Badge tone="hazard" solid>
              {failure.code === "ai_unavailable" ? "Live analysis off" : failure.code}
            </Badge>
            <p className="mt-2 text-sm leading-relaxed text-ink">{failure.message}</p>
            {failure.issues?.length ? (
              <ul className="mt-2 list-disc pl-5 text-[12px] leading-snug text-ink-soft">
                {failure.issues.map((issue) => (
                  <li key={issue} className="font-mono">
                    {issue}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {analysis && (mode === "valuation" || mode === "intake") ? (
        <ValuationResult analysis={analysis} />
      ) : null}
      {mode === "intake" && intake ? (
        <IntakeResult result={intake} />
      ) : null}
      {mode === "gatekeeper" && decision ? (
        <DecisionResult decision={decision} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ results */

function Provenance({ source, warnings }: { source: AiAnalysis["source"]; warnings: string[] }) {
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="ink">Gemini · {source.model}</Badge>
        <Badge tone="neutral">{(source.latencyMs / 1000).toFixed(1)} s</Badge>
        <Badge tone="neutral">{source.inputs.join(" + ")}</Badge>
        <span className="font-mono text-[11px] text-ink-muted">{source.calledAt}</span>
      </p>
      {warnings.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <li key={warning} className="text-[12px] leading-snug text-ink-muted">
              — {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ValuationResult({ analysis }: { analysis: AiAnalysis }) {
  const { identified, valuation, gatekeeper, materials } = analysis;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        eyebrow="Result · Identification"
        title={identified.itemLabel}
        actions={<Stamp verdict={gatekeeper.verdict} />}
      >
        <FieldList columns={2}>
          <Field label="Brand" value={identified.brand} mono />
          <Field label="Class" value={identified.className} />
          <Field label="CPCB category" value={identified.cpcb} />
          <Field label="Mass estimate" value={formatMass(identified.massGrams)} mono />
        </FieldList>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={conditionTone(identified.condition)}>{identified.condition}</Badge>
          {identified.hazardous ? <Badge tone="hazard">Hazardous fraction present</Badge> : null}
          {identified.unitCount > 1 ? (
            <Badge tone="neutral">{identified.unitCount} units</Badge>
          ) : null}
          <Badge tone={verdictTone(gatekeeper.verdict)}>
            {formatConfidence(gatekeeper.confidence)} confidence
          </Badge>
        </div>
        {identified.hazards.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-1 border-t border-rule pt-3">
            {identified.hazards.map((hazard) => (
              <li key={hazard} className="text-[13px] leading-snug text-ink-soft">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-hazard">
                  Hazard
                </span>{" "}
                {hazard}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Surface>
        <Table caption="Material assay, priced against the EcoEPR rate card">
          <THead>
            <TR>
              <TH>Material</TH>
              <TH>Grade</TH>
              <TH numeric>Mass</TH>
              <TH numeric>Rate</TH>
              <TH numeric>Value</TH>
              <TH>Handling</TH>
            </TR>
          </THead>
          <TBody>
            {materials.map((line) => (
              <TR key={`${line.id}-${line.name}`}>
                <TD>
                  <span className="font-mono text-[11px] text-ink-muted">{line.symbol}</span>{" "}
                  <span className="font-medium">{line.name}</span>
                </TD>
                <TD>
                  <Badge tone={materialTone(line.category)}>{line.category}</Badge>
                </TD>
                <TD numeric mono>
                  {formatMass(line.massGrams)}
                </TD>
                <TD numeric mono>
                  {line.ratePerKg > 0 ? formatRate(line.ratePerKg) : "—"}
                </TD>
                <TD numeric mono>
                  {lineValue(line.massGrams, line.ratePerKg) > 0
                    ? formatInr(lineValue(line.massGrams, line.ratePerKg))
                    : "—"}
                </TD>
                <TD className="text-[12px] text-ink-soft">{line.handling}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel eyebrow="Result · Payout" title="What the collector is offered">
          <FieldList columns={2}>
            <Field label="Gross material value" value={formatInr(valuation.grossValue)} mono />
            <Field label="Handling fee" value={`− ${formatInr(valuation.handlingFee)}`} mono />
            <Field label="Net to collector" value={formatInr(valuation.netToCollector)} mono />
            <Field
              label="EPR credit"
              value={valuation.eprCreditInr > 0 ? formatInr(valuation.eprCreditInr) : "None issued"}
              mono
            />
          </FieldList>
          <p className="mt-4 border-t border-rule pt-3 font-mono text-[11px] leading-relaxed text-ink-muted">
            {valuation.eprCreditNote}
            <br />
            {valuation.rateBasis}
            <br />
            Valid until {valuation.validUntil}
          </p>
        </Panel>

        <Panel
          eyebrow={
            gatekeeper.ruleCode
              ? `Result · Gatekeeper · ${gatekeeper.ruleCode}`
              : "Result · Gatekeeper"
          }
          title={gatekeeper.matchedClass}
        >
          <p className="text-sm leading-relaxed text-ink-soft">{gatekeeper.reason}</p>
          {gatekeeper.signals.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2 border-t border-rule pt-3">
              {gatekeeper.signals.map((signal) => (
                <li key={`${signal.label}-${signal.value}`} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                    {signal.label}
                  </span>
                  <span className="text-[13px] text-ink">{signal.value}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex items-center gap-3">
            <Meter value={gatekeeper.confidence} tone="copper" size="sm" className="w-28" />
            <span className="font-mono text-[12px] tabular-nums text-ink-soft">
              {formatConfidence(gatekeeper.confidence)} confidence
            </span>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Provenance" title="What produced this">
        <Provenance source={analysis.source} warnings={analysis.warnings} />
      </Panel>
    </div>
  );
}

function IntakeResult({ result }: { result: AiIntakeResult }) {
  return (
    <div className="flex flex-col gap-6">
      {result.voiceNote ? (
        <VoiceNoteCard
          voiceNote={result.voiceNote}
          engine={`Gemini · ${result.source.model}`}
        />
      ) : null}

      <Panel eyebrow="Result · Extraction" title="What was pulled out">
        <ExtractionTable
          extracted={result.fields}
          caption="Every field carries the confidence that matters more than the value"
        />
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <Badge tone="ink">Gemini · {result.source.model}</Badge>
          <Badge tone="neutral">{(result.source.latencyMs / 1000).toFixed(1)} s</Badge>
          <span className="text-[12px] leading-snug text-ink-muted">
            Each field says whether it came from the photo or the voice note.
          </span>
        </p>
      </Panel>

      {result.analysis ? <ValuationResult analysis={result.analysis} /> : null}
    </div>
  );
}

function DecisionResult({ decision }: { decision: GatekeeperDecision }) {
  const headline = decision.creditable
    ? decision.verdict === "verified"
      ? "Creditable"
      : "Held for a human"
    : "Not creditable";

  return (
    <Panel
      eyebrow={`Result · Gatekeeper${decision.ruleCode !== "none" ? ` · ${decision.ruleCode}` : ""}`}
      title={decision.subject}
      actions={<VerdictMark verdict={decision.verdict} />}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={verdictTone(decision.verdict)} solid>
          {headline}
        </Badge>
        <Badge tone={decision.hazardous ? "hazard" : "neutral"}>
          {decision.hazardous ? "Hazardous fraction" : "No hazard flagged"}
        </Badge>
        <Badge tone="neutral">{decision.brand}</Badge>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink-soft">{decision.reason}</p>

      <FieldList columns={2} className="mt-4">
        <Field label="Matched class" value={decision.matchedClass} />
        <Field label="CPCB category" value={decision.cpcb} />
        <Field label="Mass estimate" value={formatMass(decision.massGrams)} mono />
        <Field
          label={decision.verdict === "rejected" ? "Credit withheld" : "Credit issued"}
          value={
            decision.withheldCreditInr > 0 ? formatInr(decision.withheldCreditInr) : "None"
          }
          mono
        />
      </FieldList>

      <div className="mt-4 flex items-center gap-3">
        <Meter value={decision.confidence} tone="copper" size="sm" className="w-28" />
        <span className="font-mono text-[12px] tabular-nums text-ink-soft">
          {formatConfidence(decision.confidence)} confidence
        </span>
      </div>

      {decision.signals.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2 border-t border-rule pt-3">
          {decision.signals.map((signal) => (
            <li key={`${signal.label}-${signal.value}`} className="flex flex-wrap gap-x-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
                {signal.label}
              </span>
              <span className="text-[13px] text-ink">{signal.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 border-t border-rule pt-3 font-mono text-[11px] text-ink-muted">
        {decision.creditNote} · {decision.checkedAt}
      </p>

      <div className="mt-4">
        <Provenance source={decision.source} warnings={decision.warnings} />
      </div>
    </Panel>
  );
}

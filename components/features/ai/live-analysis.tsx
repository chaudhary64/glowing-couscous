"use client";

import { useEffect, useRef, useState } from "react";

import { ExtractionTable } from "@/components/features/intake/extraction-table";
import { VoiceNoteCard } from "@/components/features/intake/voice-note-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { Field, FieldList } from "@/components/ui/field-list";
import { Meter } from "@/components/ui/meter";
import { Stamp, VerdictMark } from "@/components/ui/stamp";
import { AnalysisScanner } from "./analysis-scanner";
import { LiveWaveform } from "./live-waveform";
import { saveConsent, useConsent } from "@/lib/consent";
import { formatConfidence, formatInr, formatMass, formatRate, lineValue } from "@/lib/format";
import { conditionTone, materialTone, verdictTone } from "@/lib/tone";
import type { AiAnalysis, AiIntakeResult } from "@/lib/ai/proposal";
import type { LocationOutcome } from "@/lib/intake/location";
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

/**
 * Plain words for every failure code the panel can be handed, so the badge names the
 * cause instead of echoing a machine code at whoever is standing in the lane.
 *
 * A key with no credits, a key that was rejected, a retired model id and a merely busy
 * model are four different problems with four different fixes; `ai_call_failed` over all
 * of them told the reader nothing and sent them to the wrong place. Anything not listed
 * still falls through as its own code rather than being hidden.
 */
const FAILURE_LABELS: Record<string, string> = {
  ai_unavailable: "Live analysis off",
  ai_credits: "AI credits exhausted",
  ai_key_rejected: "AI key rejected",
  ai_model_missing: "AI model retired",
  ai_at_capacity: "AI at capacity — retry",
  ai_call_failed: "AI call failed",
  ai_reply_invalid: "Reply not priceable",
  ai_failed: "AI failed",
  cross_origin: "Blocked request",
  unauthorized: "Sign-in needed",
  forbidden: "Not your role",
  payload_too_large: "Upload too large",
  unsupported_media: "Unsupported file type",
  empty_request: "Nothing attached",
  bad_request: "Request rejected",
  mic_denied: "Microphone refused",
  no_recorder: "Recording unavailable",
  network: "No connection",
};

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
  /**
   * Reject rule that fired, or absent. Optional because the live path omits it for a
   * verified item — `lib/types.ts` declares it optional and `lib/ai/analyse.ts` maps
   * `"none"` to `undefined` — while the fixtures always carry a code.
   */
  ruleCode?: string;
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
 * A recording stops itself here. 16 kHz mono WAV is 32 KB a second, so a minute is
 * about 1.9 MB - inside `MAX_AUDIO_BYTES` with room for a photo in the same request.
 */
const MAX_RECORDING_SECONDS = 60;

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
    body: "A photo, a voice note in Hindi, or both. The voice note is transcribed first (Hindi, Azure Speech), then the photograph and the transcript are read together — the extracted fields and the price come back with it.",
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

/**
 * Microsoft Foundry reads WAV or MP3 audio and nothing else, while a browser records
 * WebM. Rather than send a container the model refuses, the clip is decoded with the
 * browser's own audio decoder and re-encoded as 16 kHz mono PCM WAV — small enough to
 * fit the request budget and the shape speech models actually want. Decoding also
 * measures the real duration, so the length on screen is measured, not inferred.
 */
async function decodeMono(
  source: Blob,
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  let decoded: AudioBuffer;
  try {
    // `slice(0)` because Safari detaches the buffer handed to `decodeAudioData`.
    const bytes = await source.arrayBuffer();
    const ctx = new AudioCtx();
    decoded = await ctx.decodeAudioData(bytes.slice(0));
    await ctx.close();
  } catch {
    return null;
  }

  const targetRate = 16_000;
  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (OfflineCtx) {
    try {
      const frames = Math.max(1, Math.ceil(decoded.duration * targetRate));
      const offline = new OfflineCtx(1, frames, targetRate);
      const node = offline.createBufferSource();
      node.buffer = decoded;
      node.connect(offline.destination);
      node.start();
      const rendered = await offline.startRendering();
      return { samples: rendered.getChannelData(0), sampleRate: targetRate };
    } catch {
      // Fall through to a straight downmix rather than failing the upload.
    }
  }

  const channels = decoded.numberOfChannels;
  const out = new Float32Array(decoded.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) out[i] += data[i] / channels;
  }
  return { samples: out, sampleRate: decoded.sampleRate };
}

/** 16-bit PCM WAV, mono — the smallest container every speech path accepts. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode any browser-readable clip and hand back WAV ready for the request. */
async function audioToMedia(
  source: Blob,
  label: string,
): Promise<{ media: Media; seconds: number } | null> {
  const decoded = await decodeMono(source);
  if (!decoded) return null;
  const wav = encodeWav(decoded.samples, decoded.sampleRate);
  return {
    media: { mimeType: "audio/wav", dataBase64: bytesToBase64(wav), label },
    seconds: decoded.samples.length / decoded.sampleRate,
  };
}

type Located = { latitude: number; longitude: number; accuracyM: number };
type LocateState = "idle" | "locating" | "ok" | "denied" | "unavailable";

/** The intake response, with what the server recorded alongside the analysis. */
type RecordedIntake = AiIntakeResult & {
  submission?: { configured: boolean; submission: { code: string } | null; error: string | null } | null;
  location?: LocationOutcome | null;
};

export function LiveAnalysis({ mode }: { mode: LiveMode }) {
  const [photo, setPhoto] = useState<Media | null>(null);
  const [audio, setAudio] = useState<Media | null>(null);
  const [audioSeconds, setAudioSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  /** Seconds into the current recording, for the on-screen counter. */
  const [recordingFor, setRecordingFor] = useState(0);
  // The live microphone stream, as state so the waveform re-renders with it.
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  /** A clip is being decoded and re-encoded; nothing is attached yet. */
  const [processingAudio, setProcessingAudio] = useState(false);
  const [note, setNote] = useState("");
  const [declaredMass, setDeclaredMass] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [intake, setIntake] = useState<RecordedIntake | null>(null);
  const [location, setLocation] = useState<Located | null>(null);
  const [locate, setLocate] = useState<LocateState>("idle");
  /** Intake submitted with no fix yet: ask once, inline, before sending. */
  const [askLocation, setAskLocation] = useState(false);
  const consent = useConsent();
  const [decision, setDecision] = useState<GatekeeperDecision | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  /**
   * Bumped whenever the voice slot is replaced or emptied. Decoding is async, so a clip
   * that finishes after the collector removed it (or started another) checks this and
   * is dropped instead of reattaching itself.
   */
  const audioGeneration = useRef(0);

  // Leaving the page mid-recording releases the microphone.
  useEffect(
    () => () => {
      audioGeneration.current += 1;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  // The counter, and the hard stop at MAX_RECORDING_SECONDS.
  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      setRecordingFor(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const copy = COPY[mode];
  const running = status === "running";
  const hasInput = Boolean(photo || audio || note.trim());

  /**
   * Always a tap, never an automatic prompt: the browser asks permission the first
   * time, and a collector who says no still gets paid - the location only feeds the
   * hotspot map. High accuracy because a ward or district boundary can run down the
   * middle of a lane. Resolves with the fix (or null) so a submit can use it at once.
   */
  function captureLocation(): Promise<Located | null> {
    if (!("geolocation" in navigator)) {
      setLocate("unavailable");
      return Promise.resolve(null);
    }
    setLocate("locating");
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const fix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
          };
          setLocation(fix);
          setLocate("ok");
          resolve(fix);
        },
        (error) => {
          setLocation(null);
          setLocate(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
      );
    });
  }

  /**
   * With location consented to (the cookie notice), the intake screen captures the
   * position as it opens: silently if the browser already allows it, with the browser's
   * own one-time prompt if it has not been asked, and not at all if it was blocked -
   * then the screen says so instead of asking again.
   */
  const autoLocated = useRef(false);
  useEffect(() => {
    if (mode !== "intake" || !consent?.location || autoLocated.current) return;
    autoLocated.current = true;
    const query = navigator.permissions?.query({ name: "geolocation" as PermissionName });
    void (query ?? Promise.resolve(null))
      .then((status) => {
        if (status?.state === "denied") setLocate("denied");
        else void captureLocation();
      })
      .catch(() => void captureLocation());
  }, [mode, consent]);

  /** A collector who adds a location by hand, before any choice was recorded, has made one. */
  function locateByHand() {
    if (consent === null) saveConsent(true);
    return captureLocation();
  }

  /**
   * Submit. An intake with no fix, where the device has not already refused or failed
   * to give one, first asks once - inline, never a browser dialog - whether to add it.
   */
  function submit() {
    if (mode === "intake" && !location && locate !== "denied" && locate !== "unavailable") {
      setAskLocation(true);
      return;
    }
    void run();
  }

  function removePhoto() {
    setPhoto(null);
    if (photoInput.current) photoInput.current.value = "";
  }

  function removeAudio() {
    audioGeneration.current += 1;
    setAudio(null);
    setAudioSeconds(0);
    setProcessingAudio(false);
    if (audioInput.current) audioInput.current.value = "";
  }

  function reset() {
    removePhoto();
    removeAudio();
    setNote("");
    setDeclaredMass("");
    setAnalysis(null);
    setIntake(null);
    setDecision(null);
    setFailure(null);
    setStatus("idle");
  }

  async function pickPhoto(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      // Empty the picker too, so it never names a file that is not the one attached.
      input.value = "";
      setFailure({
        code: "payload_too_large",
        message: `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 3 MB so the upload survives a patchy connection.`,
      });
      return;
    }
    setFailure(null);
    try {
      setPhoto(await readFile(file));
    } catch {
      input.value = "";
      setFailure({ code: "unsupported_media", message: "That photo could not be read. Try another file." });
    }
  }

  /**
   * Decode, re-encode and attach a clip - from the picker or the recorder alike. The
   * size limit is checked on the WAV that is actually sent, not the source file: a small
   * compressed clip can decode to far more than it started as.
   */
  async function attachAudio(source: Blob, label: string, origin: "file" | "recording") {
    const generation = ++audioGeneration.current;
    setFailure(null);
    setProcessingAudio(true);
    const converted = await audioToMedia(source, label);
    if (generation !== audioGeneration.current) return; // removed or replaced meanwhile
    setProcessingAudio(false);
    const clear = () => {
      if (audioInput.current) audioInput.current.value = "";
    };
    if (!converted) {
      clear();
      setFailure({
        code: "unsupported_media",
        message:
          origin === "recording"
            ? "That recording could not be decoded. Try again, or attach a WAV or MP3 clip."
            : "That audio could not be decoded in this browser. Record the note instead, or attach a WAV or MP3 clip.",
      });
      return;
    }
    if ((converted.media.dataBase64.length * 3) / 4 > MAX_AUDIO_BYTES) {
      clear();
      setFailure({
        code: "payload_too_large",
        message: `That clip runs ${Math.round(converted.seconds)} s, which is over 3 MB once prepared for upload. Keep it under about ${MAX_RECORDING_SECONDS} seconds.`,
      });
      return;
    }
    // A recording replaces whatever the picker held, so the picker must not still name it.
    if (origin === "recording") clear();
    setAudio(converted.media);
    setAudioSeconds(converted.seconds);
  }

  async function pickAudio(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_AUDIO_BYTES) {
      input.value = "";
      setFailure({
        code: "payload_too_large",
        message: `That clip is ${(file.size / 1024 / 1024).toFixed(1)} MB. Keep it under 3 MB — ten seconds of speech is plenty.`,
      });
      return;
    }
    await attachAudio(file, file.name || "clip", "file");
  }

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }

  async function toggleRecording() {
    if (recording) {
      stopRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setFailure({
        code: "no_recorder",
        // Browsers hide the microphone entirely on plain http (anything but localhost).
        message: window.isSecureContext
          ? "This browser will not record audio. Attach a clip instead."
          : "Recording needs a secure (https) connection, and this page was opened over plain http. Attach a clip instead, or open the site over https.",
      });
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const active = new MediaRecorder(mic);
      stream.current = mic;
      setMicStream(mic);
      chunks.current = [];
      active.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      active.onstop = () => {
        mic.getTracks().forEach((track) => track.stop());
        if (stream.current === mic) stream.current = null;
        setMicStream(null);
        const blob = new Blob(chunks.current, { type: active.mimeType || "audio/webm" });
        chunks.current = [];
        if (blob.size === 0) return;
        void attachAudio(blob, "voice-note.wav", "recording");
      };
      recorder.current = active;
      active.start();
      setRecordingFor(0);
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

  async function run(fix: Located | null = location) {
    setAskLocation(false);
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
    if (mode === "intake" && fix) body.location = fix;

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

      if (mode === "intake") setIntake(payload as unknown as RecordedIntake);
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
              onChange={(event) => void pickPhoto(event.currentTarget)}
              disabled={running}
              className="block w-full border border-rule bg-paper px-3 py-2 font-mono text-[11px] text-ink file:mr-3 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-mono file:text-[10px] file:uppercase file:tracking-[0.14em] file:text-paper"
            />
            {photo ? (
              <div className="flex items-center gap-3">
                {/* A data URL the browser already holds; next/image has nothing to optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${photo.mimeType};base64,${photo.dataBase64}`}
                  alt="The attached photo"
                  className="h-14 w-14 shrink-0 border border-rule bg-paper object-cover"
                  onError={(event) => {
                    // HEIC will not preview outside Safari; the file is still attached.
                    event.currentTarget.style.display = "none";
                  }}
                />
                <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-muted">
                  <Badge tone="copper">Attached</Badge>{" "}
                  <span className="break-all font-mono">{photo.label}</span>
                </p>
                <Button variant="ghost" onClick={removePhoto} disabled={running} aria-label="Remove the photo">
                  Remove
                </Button>
              </div>
            ) : (
              <p className="text-[12px] leading-snug text-ink-muted">JPEG, PNG, WebP or HEIC, up to 3 MB.</p>
            )}
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
                disabled={running || processingAudio}
              >
                {recording
                  ? `Stop · ${Math.floor(recordingFor)} / ${MAX_RECORDING_SECONDS} s`
                  : audio
                    ? "Record again"
                    : "Record"}
              </Button>
              <input
                ref={audioInput}
                type="file"
                accept="audio/webm,audio/ogg,audio/wav,audio/mpeg,audio/mp4"
                onChange={(event) => void pickAudio(event.currentTarget)}
                disabled={running || recording || processingAudio}
                className="block max-w-[16rem] border border-rule bg-paper px-3 py-2 font-mono text-[11px] text-ink"
              />
            </div>
            {recording ? (
              <div className="flex flex-col gap-2">
                <LiveWaveform stream={micStream} />
                <p className="flex items-center gap-2 text-[12px] leading-snug text-ink" role="status">
                  <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-hazard" />
                  Recording. It stops by itself at {MAX_RECORDING_SECONDS} seconds.
                </p>
              </div>
            ) : processingAudio ? (
              <p className="text-[12px] leading-snug text-ink-muted" role="status">
                Preparing the clip…
              </p>
            ) : audio ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-[12px] leading-snug text-ink-muted">
                    <Badge tone="copper">Attached</Badge>{" "}
                    <span className="break-all font-mono">
                      {audio.label}
                      {audioSeconds > 0 ? ` · ${Math.max(1, Math.round(audioSeconds))} s` : ""}
                    </span>
                  </p>
                  <Button variant="ghost" onClick={removeAudio} disabled={running} aria-label="Remove the voice note">
                    Remove
                  </Button>
                </div>
                {/* Play it back before sending: the collector can hear what will be transcribed. */}
                <audio controls preload="metadata" src={`data:${audio.mimeType};base64,${audio.dataBase64}`} className="h-9 w-full" />
              </div>
            ) : (
              <p className="text-[12px] leading-snug text-ink-muted">
                Up to {MAX_RECORDING_SECONDS} seconds. A recording is re-encoded here as 16 kHz WAV and transcribed server-side.
              </p>
            )}
          </Surface>
        </div>

        {mode === "intake" ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Surface tone="inset" className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                Location · for the hotspot map
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => void locateByHand()} disabled={running || locate === "locating"}>
                  {locate === "locating" ? "Locating…" : location ? "Update location" : "Use this device’s location"}
                </Button>
                {location ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setLocation(null);
                      setLocate("idle");
                    }}
                    disabled={running}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
              <p className="text-[12px] leading-snug text-ink-muted">
                {locate === "ok" && location ? (
                  <>
                    <Badge tone="copper">Attached</Badge>{" "}
                    <span className="font-mono">
                      {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)} · ±{Math.round(location.accuracyM)} m
                    </span>
                  </>
                ) : locate === "denied" ? (
                  "Location was refused. The submission still works; it just adds no point to the map."
                ) : locate === "unavailable" ? (
                  "This device could not give a fix. The submission still works without one."
                ) : (
                  "Optional. Filed to its district (its BMC ward in Mumbai) and counted on the hotspot map — never shown as an exact address."
                )}
              </p>
            </Surface>

          </div>
        ) : null}

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
          <Button onClick={submit} disabled={running || !hasInput || askLocation || recording || processingAudio}>
            {running ? "Analysing…" : copy.action}
          </Button>
          <span className="text-[12px] leading-snug text-ink-muted">
            {recording
              ? "Stop the recording first, so it goes with the submission."
              : processingAudio
                ? "Waiting for the clip to be prepared…"
                : hasInput
              ? "The model names the materials; the rate card prices them on the server."
              : "Attach a photo, record a note, or describe the item."}
          </span>
        </div>

        {running ? <AnalysisScanner mode={mode} photo={photo} hasAudio={Boolean(audio)} /> : null}

        {askLocation ? (
          <div role="group" aria-label="Add a location" className="mt-4 border-2 border-copper bg-copper-tint p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-copper">No location yet</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">
              Add this device&apos;s location? It files the intake to its district (its BMC ward in Mumbai) and counts it
              on the hotspot map. The collector is paid either way.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void locateByHand().then((fix) => run(fix));
                }}
                disabled={locate === "locating"}
              >
                {locate === "locating" ? "Finding location…" : "Add location and submit"}
              </Button>
              <Button variant="secondary" onClick={() => void run(null)} disabled={locate === "locating"}>
                Submit without
              </Button>
            </div>
          </div>
        ) : null}

        {failure ? (
          <div className="mt-4 border-2 border-hazard bg-hazard-tint p-4">
            <Badge tone="hazard" solid>
              {FAILURE_LABELS[failure.code] ?? failure.code}
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

      {/* Results arrive while on screen, so the scroll observer leaves them be; the
          cascade below is their entrance instead (globals.css, .result-cascade). */}
      {analysis && (mode === "valuation" || mode === "intake") ? (
        <div className="result-cascade">
          <ValuationResult analysis={analysis} />
        </div>
      ) : null}
      {mode === "intake" && intake ? (
        <div className="result-cascade">
          <IntakeResult result={intake} />
        </div>
      ) : null}
      {mode === "gatekeeper" && decision ? (
        <div className="result-cascade">
          <DecisionResult decision={decision} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ results */

function Provenance({ source, warnings }: { source: AiAnalysis["source"]; warnings: string[] }) {
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone="ink">Foundry · {source.model}</Badge>
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
        actions={
          <span className="stamp-strike inline-block">
            <Stamp verdict={gatekeeper.verdict} />
          </span>
        }
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

function IntakeResult({ result }: { result: RecordedIntake }) {
  return (
    <div className="flex flex-col gap-6">
      {result.submission?.configured || result.location?.configured ? (
        <Surface tone="inset" className="flex flex-wrap items-center gap-2 p-4">
          {result.submission?.submission ? (
            <Badge tone="verified">Filed · {result.submission.submission.code}</Badge>
          ) : (
            <Badge tone="hazard">Not filed</Badge>
          )}
          {result.location?.recorded || result.location?.skipped ? (
            <Badge tone="copper">
              {result.location.wardName
                ? `${result.location.wardName}${result.location.areaKind === "ward" ? " · Mumbai" : result.location.stateName ? ` · ${result.location.stateName}` : ""}`
                : "Outside India"}
            </Badge>
          ) : (
            <Badge tone="lead">No location</Badge>
          )}
          <span className="text-[12px] leading-snug text-ink-muted">
            {result.location?.error ??
              result.location?.skipped ??
              (result.location?.recorded && result.location.wardCode
                ? "Counted on the hotspot map."
                : "Recorded as an intake.")}
          </span>
        </Surface>
      ) : null}
      {result.voiceNote ? (
        <VoiceNoteCard
          voiceNote={result.voiceNote}
          engine="Azure Speech · hi-IN"
          typeOut
        />
      ) : null}

      <Panel eyebrow="Result · Extraction" title="What was pulled out">
        <ExtractionTable
          extracted={result.fields}
          caption="Every field carries the confidence that matters more than the value"
        />
        <p className="mt-4 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <Badge tone="ink">Foundry · {result.source.model}</Badge>
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
      eyebrow={`Result · Gatekeeper${
        // Truthy *and* not the sentinel: an absent code has to read as no code. Comparing
        // against `"none"` alone rendered the heading as `· undefined` on the live route,
        // where a verified item carries no rule at all.
        decision.ruleCode && decision.ruleCode !== "none" ? ` · ${decision.ruleCode}` : ""
      }`}
      title={decision.subject}
      actions={
        <span className="stamp-strike inline-block">
          <VerdictMark verdict={decision.verdict} />
        </span>
      }
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

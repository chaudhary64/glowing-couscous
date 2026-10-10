"use client";

import { useEffect, useRef } from "react";

/**
 * The microphone's level while a voice note records: copper bars that move with the
 * collector's voice, so they can see the phone is hearing them. Reads the same stream
 * the MediaRecorder is writing, through an AnalyserNode, and never records anything
 * itself. Under reduced motion it draws a calm, static level line instead.
 */
export function LiveWaveform({ stream }: { stream: MediaStream | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!stream || !element) return;
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;

    const audio = new Context();
    const source = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = element.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const copper = getComputedStyle(element).getPropertyValue("--color-copper").trim() || "#a2542a";
    const bars = 36;
    let frame = 0;

    const render = () => {
      if (!draw) return;
      const { width, height } = element;
      analyser.getByteFrequencyData(data);
      draw.clearRect(0, 0, width, height);
      draw.fillStyle = copper;
      const gap = 3;
      const barWidth = (width - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i += 1) {
        // Voice sits in the lower bins; mirror them so the shape reads as a waveform.
        const bin = Math.floor((Math.abs(i - bars / 2) / (bars / 2)) * (data.length * 0.45));
        const level = reduce ? 0.18 : Math.max(0.06, data[bin] / 255);
        const h = Math.max(2, level * height);
        draw.fillRect(i * (barWidth + gap), (height - h) / 2, barWidth, h);
      }
      if (!reduce) frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void audio.close();
    };
  }, [stream]);

  return (
    <canvas
      ref={canvas}
      width={360}
      height={44}
      aria-hidden
      className="h-11 w-full max-w-[360px]"
    />
  );
}

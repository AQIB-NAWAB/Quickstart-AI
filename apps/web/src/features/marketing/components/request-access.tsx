"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Mic, MicOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import "../styles/request-access.css";

type Step = "name" | "email" | "useCase" | "confirm" | "done";
type SpeechResult = { results: ArrayLike<{ 0: { transcript: string } }> };
type Recognition = { lang: string; interimResults: boolean; onresult: ((event: SpeechResult) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const MAX_TURNS = 10;
const SESSION_LIMIT_MS = 120_000;
const INTRO = "Hi, welcome to QuickStart AI! We're currently offering early access. I can answer your questions or help you request access. What would you like to know?";

function parseEmail(text: string) {
  return text.toLowerCase().trim().replace(/\s+at\s+/g, "@").replace(/\s+dot\s+/g, ".").replace(/\s+/g, "").replace(/[,;]+/g, "");
}

async function playVoice(response: Response, player: HTMLAudioElement, signal: AbortSignal) {
  const streaming = response.body && response.headers.get("content-type")?.includes("audio/mpeg") && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
  const source = streaming ? new MediaSource() : null;
  const url = URL.createObjectURL(source ?? await response.blob());
  player.src = url;
  const finished = new Promise<void>((resolve, reject) => {
    player.onended = () => resolve();
    player.onerror = () => reject(new Error("Could not play the voice response."));
    signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  });
  void finished.catch(() => {});
  try {
    if (!source || !response.body) {
      await player.play();
    } else {
      await new Promise<void>((resolve, reject) => {
        source.addEventListener("sourceopen", () => resolve(), { once: true });
        signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
      });
      const buffer = source.addSourceBuffer("audio/mpeg");
      const reader = response.body.getReader();
      let playing = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        await new Promise<void>((resolve, reject) => {
          buffer.addEventListener("updateend", () => resolve(), { once: true });
          buffer.addEventListener("error", () => reject(new Error("Could not play the voice response.")), { once: true });
          buffer.appendBuffer(value.slice().buffer as ArrayBuffer);
        });
        if (!playing) { playing = true; await player.play(); }
      }
      if (!playing) throw new Error("The voice response was empty.");
      if (source.readyState === "open") source.endOfStream();
    }
    await finished;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function AnimatedField({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState("");
  const editing = useRef(false);
  useEffect(() => {
    if (editing.current) { setShown(value); return; }
    let index = 0;
    setShown("");
    const sound = value && typeof AudioContext !== "undefined" ? new AudioContext() : null;
    const timer = window.setInterval(() => {
      index += 1; setShown(value.slice(0, index));
      if (sound && sound.state === "running" && index % 3 === 0) {
        const tone = sound.createOscillator(); const volume = sound.createGain();
        tone.frequency.value = 750; volume.gain.setValueAtTime(0.012, sound.currentTime);
        volume.gain.exponentialRampToValueAtTime(0.0001, sound.currentTime + 0.025);
        tone.connect(volume); volume.connect(sound.destination); tone.start(); tone.stop(sound.currentTime + 0.025);
      }
      if (index >= value.length) window.clearInterval(timer);
    }, 35);
    return () => { window.clearInterval(timer); void sound?.close(); };
  }, [value]);
  return <div className={`voice-field ${shown.length < value.length ? "is-typing" : ""}`}><label>{label}<span>{shown.length < value.length ? "ADDING DETAILS" : "CAPTURED"}</span></label><input type={type} value={shown} onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} onChange={(event) => { setShown(event.target.value); onChange(event.target.value); }} /></div>;
}

export function RequestAccess() {
  const [started, setStarted] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [useCase, setUseCase] = useState("");
  const [, setReply] = useState(INTRO);
  const [status, setStatus] = useState("Ready when you are");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState(0);
  const [error, setError] = useState("");
  const [manual, setManual] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const active = useRef(false);
  const sessionVersion = useRef(0);
  const startedAt = useRef(0);
  const state = useRef({ step, name, email, useCase, turns });
  state.current = { step, name, email, useCase, turns };
  const listenRef = useRef<() => void>(() => {});
  const handleRef = useRef<(text: string) => void>(() => {});
  const history = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const awaitingConfirmation = useRef(false);

  const stop = useCallback(() => {
    active.current = false;
    awaitingConfirmation.current = false;
    sessionVersion.current += 1;
    setSessionActive(false);
    try { recognition.current?.stop(); } catch { /* Already stopped. */ }
    recognition.current = null;
    audio.current?.pause();
    speechAbort.current?.abort();
    setListening(false); setSpeaking(false); setStatus("Session ended");
  }, []);
  useEffect(() => () => { active.current = false; try { recognition.current?.stop(); } catch { /* Already stopped. */ } audio.current?.pause(); speechAbort.current?.abort(); }, []);
  useEffect(() => {
    if (!started) return;
    const timer = window.setTimeout(() => { if (active.current) { stop(); setManual(true); } }, SESSION_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [started, stop]);

  const speak = useCallback(async (text: string, resume = true) => {
    const version = sessionVersion.current;
    setReply(text); setStatus("Getting ready to speak"); setError(""); setSpeaking(true);
    const controller = new AbortController();
    speechAbort.current = controller;
    try {
      const response = await fetch("/api/access-voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: controller.signal });
      if (!response.ok) throw new Error("Voice is temporarily unavailable. Tap to try again.");
      if (!active.current || version !== sessionVersion.current) return;
      const player = new Audio(); audio.current = player;
      setSpeaking(true); setStatus("Speaking");
      await playVoice(response, player, controller.signal);
      if (version !== sessionVersion.current) return;
      setSpeaking(false);
      if (resume && active.current && version === sessionVersion.current) listenRef.current();
      else setStatus("All done");
    } catch (err) {
      if (version !== sessionVersion.current) return;
      active.current = false; setSessionActive(false); setSpeaking(false); setStatus("Voice unavailable"); setError(err instanceof Error ? err.message : "Voice unavailable.");
    }
  }, []);

  listenRef.current = () => {
    if (!active.current) return;
    if (Date.now() - startedAt.current >= SESSION_LIMIT_MS || state.current.turns >= MAX_TURNS) { stop(); setManual(true); return; }
    const Speech = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;
    if (!Speech) { stop(); setError("Voice input is unavailable in this browser. Please complete the form."); return; }
    const instance = new Speech(); recognition.current = instance; instance.lang = "en-US"; instance.interimResults = false;
    let received = false;
    let retry = true;
    instance.onresult = (event) => { received = true; setListening(false); handleRef.current(event.results[0]?.[0]?.transcript ?? ""); };
    instance.onerror = (event) => {
      setListening(false);
      if (event.error === "aborted") retry = false;
      else if (event.error !== "no-speech") {
        retry = false; stop(); setError("Microphone access is unavailable. Check your browser permissions and start again.");
      }
    };
    instance.onend = () => { setListening(false); if (!received && retry && active.current) window.setTimeout(() => { if (active.current) listenRef.current(); }, 300); };
    try { instance.start(); setListening(true); setStatus("Listening"); } catch { stop(); setError("Couldn’t start the microphone. Please try again."); }
  };

  handleRef.current = async (spoken) => {
    if (!spoken.trim() || !active.current) return;
    const version = sessionVersion.current;
    const current = state.current; setTurns(current.turns + 1); setStatus("Thinking");
    if (current.step === "confirm" && awaitingConfirmation.current && /^(yes|yeah|yep|sure|submit|send|please do|go ahead)([, ]+(please|it|submit|send|that))*[.!]?$/i.test(spoken.trim())) {
      awaitingConfirmation.current = false;
      await submit(current.name, current.email, current.useCase); return;
    }
    awaitingConfirmation.current = false;
    try {
      const res = await fetch("/api/access-assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: spoken, step: current.step, name: current.name, email: current.email, useCase: current.useCase, history: history.current }),
      });
      const data = await res.json();
      if (!active.current || version !== sessionVersion.current) return;
      if (!res.ok) throw new Error(data.error || "The guide couldn't respond just now.");
      const nextName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : current.name;
      const candidate = typeof data.email === "string" ? parseEmail(data.email) : "";
      const nextEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : current.email;
      const nextUseCase = typeof data.useCase === "string" && data.useCase.trim() ? data.useCase.trim() : current.useCase;
      if (nextName !== current.name) setName(nextName);
      if (nextEmail !== current.email) setEmail(nextEmail);
      if (nextUseCase !== current.useCase) setUseCase(nextUseCase);
      const nextStep: Step = !nextName ? "name" : !nextEmail ? "email" : !(nextUseCase || data.skipUseCase || current.step === "confirm") ? "useCase" : "confirm";
      setStep(nextStep);
      let response = String(data.reply);
      if (nextStep === "confirm" && !/\b(submit|send)\b[^?]*\?/i.test(response)) response += " Please check your details. May I submit your request?";
      history.current = [...history.current, { role: "user" as const, content: spoken }, { role: "assistant" as const, content: response }].slice(-6);
      await speak(response);
      if (active.current && version === sessionVersion.current) awaitingConfirmation.current = nextStep === "confirm";
    } catch (err) {
      if (version !== sessionVersion.current) return;
      active.current = false; setSessionActive(false); setStatus("Session ended"); setError(err instanceof Error ? err.message : "The guide couldn't respond just now.");
    }
  };

  async function submit(fullName: string, address: string, purpose: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError("Please enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      const result = await fetch("/api/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address, fullName, useCase: purpose }) });
      const data = await result.json(); if (!result.ok) throw new Error(data.error || "Could not submit the request.");
      setStep("done"); if (active.current) await speak("Your request is submitted. Thanks for talking with me!", false); else setReply("Your request is submitted. Thank you!");
      active.current = false; setSessionActive(false);
    } catch (err) { active.current = false; setSessionActive(false); setStatus("Review your details"); setError(err instanceof Error ? err.message : "Could not submit the request."); }
    finally { setBusy(false); }
  }

  function start() {
    if (started && active.current) { listenRef.current(); return; }
    if (started && (turns >= MAX_TURNS || Date.now() - startedAt.current >= SESSION_LIMIT_MS)) {
      setManual(true); return;
    }
    active.current = true;
    sessionVersion.current += 1;
    setSessionActive(true);
    setError("");
    if (!started) { startedAt.current = Date.now(); setStarted(true); void speak(INTRO); return; }
    const prompt = step === "name" ? "Welcome back. What would you like to know about QuickStart AI?" : step === "email" ? "Welcome back. What email address should we use?" : step === "useCase" ? "Welcome back. What would you like to use QuickStart AI for?" : "Welcome back. Please check your details, and tell me if you'd like to submit your request.";
    void speak(prompt).then(() => { if (step === "confirm" && active.current) awaitingConfirmation.current = true; });
  }
  const showName = manual || Boolean(name) || step !== "name";
  const showEmail = manual || Boolean(email) || step === "email" || step === "useCase" || step === "confirm" || step === "done";
  const showUseCase = manual || Boolean(useCase) || step === "confirm" || step === "done";

  return <main className={`voice-access ${showName ? "has-details" : ""}`}>
    <div className="voice-access-glow" aria-hidden="true" />
    <Link href="/" className="voice-back" aria-label="Back to QuickStart AI"><ArrowLeft size={21} /></Link>
    <div className="voice-layout">
      <section className="voice-stage" aria-label="Voice agent">
        <button className={`voice-orb ${listening ? "is-listening" : ""} ${speaking ? "is-speaking" : ""}`} onClick={sessionActive ? stop : start} aria-label={sessionActive ? "End session" : "Start session"} disabled={busy || step === "done"}>
          <span className="orb-ring orb-ring-one" /><span className="orb-ring orb-ring-two" /><span className="orb-ring orb-ring-three" />
          <span className="voice-orb-logo"><BrandLogo size={70} fillColor="#fff3e9" animated mood={speaking ? "working" : "idle"} /></span>
        </button>
        <div className="voice-indicator"><span /><span /><span /></div>
        <p className="voice-status">{started ? status : "Meet your QuickStart guide"}</p>
        <button className="voice-action" onClick={sessionActive ? stop : start} disabled={busy || step === "done"}>{sessionActive ? <><MicOff size={16}/> End session</> : <><Mic size={16}/> Start session</>}</button>
        {error && <p className="voice-error" role="alert">{error}</p>}
      </section>
      {showName && <section className="voice-details" aria-label="Your access request"><div className="voice-details-heading"><div className="voice-card-top"><span><BrandLogo size={25} /> QUICKSTART AI</span><span className="voice-card-live"><i /> {sessionActive ? "LIVE SESSION" : "EARLY ACCESS"}</span></div><span className="voice-card-eyebrow">YOUR REQUEST</span><h2>Let’s get to know you<span>.</span></h2><p>Your details appear here as we talk. You can edit them anytime.</p></div>
        <form onSubmit={(event) => { event.preventDefault(); stop(); void submit(name, email, useCase); }}>
          <AnimatedField label="YOUR NAME" value={name.trimStart()} onChange={setName}/>
          {showEmail && <AnimatedField label="EMAIL ADDRESS" type="email" value={email} onChange={setEmail}/>}
          {showUseCase && <AnimatedField label="WHAT ARE YOU BUILDING?" value={useCase} onChange={setUseCase}/>}
          {(showEmail || !active.current) && step !== "done" && <button className="voice-submit" disabled={busy} type="submit">{busy ? "Sending…" : "Submit request"} <ArrowRight size={16}/></button>}
          {step === "done" && <p className="voice-success">Your request has been submitted.</p>}
        </form>
      </section>}
    </div>
  </main>;
}

"use client";

// Web Audio API synths for zero-dependency sound effects
let audioCtx: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playDing() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.type = "sine";
  // Softer, rounder ding
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.05);
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
  
  // Weak haptic tap
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(50);
  }
}

export function playClunk() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  // Lower frequency hollow sound
  osc.type = "triangle";
  osc.frequency.setValueAtTime(250, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
  
  // Heavier / double haptic feedback for mistake
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([80, 40, 80]);
  }
}

export function playLevelUp() {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Major chord arpeggio for progression
  const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
  
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = "sine";
    const startTime = ctx.currentTime + index * 0.08;
    
    osc.frequency.setValueAtTime(freq, startTime);
    
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
    
    osc.start(startTime);
    osc.stop(startTime + 0.4);
  });
  
  // Celebration haptics
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([50, 50, 50, 50, 100]);
  }
}

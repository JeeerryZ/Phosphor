"use client";

import { useEffect, useRef } from "react";

// Pointy-top hex geometry
const R = 28;                   // circumradius
const HEX_W = Math.sqrt(3) * R; // flat-to-flat width
const ROW_H = R * 1.5;          // row pitch (vertical distance between centers)

// Amber: rgb(232, 160, 48)
const AMB = "232, 160, 48";

// How far a pulse ring expands before dying
const MAX_RADIUS = HEX_W * 4.5;
// Speed in px per frame (≈60 fps)
const RING_SPEED = 0.9;

interface Ring {
  x: number;
  y: number;
  radius: number;
}

interface Flash {
  x: number;
  y: number;
  alpha: number;
}

function drawHex(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6; // +30° → pointy top
    const x = cx + R * Math.cos(a);
    const y = cy + R * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function buildCenters(w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  const cols = Math.ceil(w / HEX_W) + 3;
  const rows = Math.ceil(h / ROW_H) + 3;
  for (let row = -1; row < rows; row++) {
    const ox = (row & 1) === 1 ? HEX_W / 2 : 0;
    for (let col = -1; col < cols; col++) {
      out.push([col * HEX_W + ox, row * ROW_H]);
    }
  }
  return out;
}

// Pre-render static hex grid to an offscreen canvas so we only draw it once per resize.
function buildGridCanvas(centers: [number, number][], w: number, h: number): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const gctx = off.getContext("2d")!;
  gctx.strokeStyle = `rgba(${AMB}, 0.042)`;
  gctx.lineWidth = 0.75;
  for (const [cx, cy] of centers) {
    drawHex(gctx, cx, cy);
    gctx.stroke();
  }
  return off;
}

export function BackgroundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const raw = canvasRef.current;
    if (!raw) return;
    // Rebind with explicit type so closures don't lose narrowing (TS limitation with refs).
    const el: HTMLCanvasElement = raw;
    const rawCtx = el.getContext("2d");
    if (!rawCtx) return;
    const ctx: CanvasRenderingContext2D = rawCtx;

    let raf: number;
    let centers: [number, number][] = [];
    let gridCache: HTMLCanvasElement | null = null;
    const rings: Ring[] = [];
    const flashes: Flash[] = [];

    function resize() {
      el.width = window.innerWidth;
      el.height = window.innerHeight;
      centers = buildCenters(el.width, el.height);
      gridCache = buildGridCanvas(centers, el.width, el.height);
    }

    function randomCenter(): [number, number] {
      return centers[Math.floor(Math.random() * centers.length)] ?? [0, 0];
    }

    function spawnRing() {
      const [x, y] = randomCenter();
      rings.push({ x, y, radius: 0 });
      flashes.push({ x, y, alpha: 0.22 });
    }

    function spawnFlash() {
      const [x, y] = randomCenter();
      flashes.push({ x, y, alpha: 0.065 });
    }

    let lastRingAt = 0, nextRingIn = 800 + Math.random() * 1800;
    let lastFlashAt = 0, nextFlashIn = 200 + Math.random() * 600;

    function frame(ts: number) {
      const { width, height } = el;
      ctx.clearRect(0, 0, width, height);

      // ── Static hex grid (one drawImage call) ──────────────────
      if (gridCache) ctx.drawImage(gridCache, 0, 0);

      // ── Flash cells ───────────────────────────────────────────
      let fi = 0;
      for (const f of flashes) {
        if (f.alpha < 0.004) continue;
        ctx.fillStyle = `rgba(${AMB}, ${f.alpha.toFixed(3)})`;
        drawHex(ctx, f.x, f.y);
        ctx.fill();
        f.alpha *= 0.87;
        flashes[fi++] = f;
      }
      flashes.length = fi;

      // ── Pulse rings ───────────────────────────────────────────
      let ri = 0;
      for (const ring of rings) {
        const t = ring.radius / MAX_RADIUS;
        const ringAlpha = 0.32 * (1 - t);

        // Hex cells swept by the ring frontier glow as the wave passes
        const wake = R * 1.6;
        for (const [cx, cy] of centers) {
          const d = Math.hypot(cx - ring.x, cy - ring.y);
          const diff = d - ring.radius;
          if (diff > -wake && diff < R * 0.5) {
            // Fade: peak at the frontier, zero at wake edge
            const proximity = 1 - Math.max(0, -diff) / wake;
            const cellAlpha = ringAlpha * 0.6 * proximity;
            if (cellAlpha < 0.005) continue;
            ctx.fillStyle = `rgba(${AMB}, ${cellAlpha.toFixed(3)})`;
            drawHex(ctx, cx, cy);
            ctx.fill();
          }
        }

        // Smooth circular arc over the hex sweep
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${AMB}, ${(ringAlpha * 0.7).toFixed(3)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ring.radius += RING_SPEED;
        if (ring.radius < MAX_RADIUS) rings[ri++] = ring;
      }
      rings.length = ri;

      // ── Timers ────────────────────────────────────────────────
      if (ts - lastRingAt > nextRingIn) {
        spawnRing();
        lastRingAt = ts;
        nextRingIn = 1800 + Math.random() * 2800;
      }
      if (ts - lastFlashAt > nextFlashIn) {
        spawnFlash();
        lastFlashAt = ts;
        nextFlashIn = 220 + Math.random() * 680;
      }

      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

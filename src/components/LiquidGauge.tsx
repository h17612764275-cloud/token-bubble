import { memo, useEffect, useRef } from "react";
import { listenWidgetMotion } from "../lib/bridge";
import { applyLiquidMotion, initialLiquidPhysics, stepLiquidPhysics } from "../lib/liquidPhysics";

interface Props {
  level: number;
  color: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const SHADOW: Rgb = { r: 70, g: 24, b: 48 };

function parseHex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return { r: 185, g: 120, b: 146 };
  const numeric = Number.parseInt(match[1], 16);
  return { r: (numeric >> 16) & 255, g: (numeric >> 8) & 255, b: numeric & 255 };
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount),
  };
}

function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export const LiquidGauge = memo(function LiquidGauge({ level, color }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const colorRef = useRef(color);

  useEffect(() => { levelRef.current = level; }, [level]);
  useEffect(() => { colorRef.current = color; }, [color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let physics = initialLiquidPhysics();
    let previousFrame = performance.now();
    let previousPosition: { x: number; y: number } | null = null;
    let frame = 0;
    let disposed = false;
    let unlisten: () => void = () => undefined;

    void listenWidgetMotion((position) => {
      if (previousPosition) physics = applyLiquidMotion(physics, position.x - previousPosition.x, position.y - previousPosition.y);
      previousPosition = position;
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });

    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      physics = stepLiquidPhysics(physics, (now - previousFrame) / 1000, !reducedMotion.matches);
      previousFrame = now;

      const w = rect.width;
      const h = rect.height;
      const fraction = Math.min(1, Math.max(0, levelRef.current / 100));
      const baseY = h - 2 - fraction * (h - 4);
      const motionEnergy = Math.min(
        1,
        Math.abs(physics.tilt) * 0.35 + Math.abs(physics.tiltVelocity) * 0.06 + Math.abs(physics.wave) * 0.28 + Math.abs(physics.waveVelocity) * 0.045,
      );
      const settled = reducedMotion.matches || motionEnergy < 0.008;
      const ambientPhase = now * 0.00115;
      const ambientWave = reducedMotion.matches ? 0 : 0.48;
      const dynamicWave = settled ? ambientWave : Math.min(6.5, Math.abs(physics.wave) * 2.8 + Math.abs(physics.waveVelocity) * 0.12);
      const visualTilt = settled ? 0 : physics.tilt;
      const surfacePoints: Array<[number, number]> = [];

      for (let x = -4; x <= w + 4; x += 2) {
        const normalizedX = (x - w / 2) / Math.max(1, w / 2);
        const slope = visualTilt * normalizedX * 6.5;
        const wavePhase = settled ? ambientPhase : physics.phase * 4.1;
        const wave = Math.sin((x / Math.max(1, w)) * Math.PI * 3.2 + wavePhase) * dynamicWave;
        const ripple = Math.sin((x / Math.max(1, w)) * Math.PI * 6.4 - wavePhase * .66) * dynamicWave * 0.22;
        surfacePoints.push([x, baseY + slope + wave + ripple]);
      }

      context.beginPath();
      context.moveTo(-5, h + 5);
      context.lineTo(surfacePoints[0][0], surfacePoints[0][1]);
      for (const [x, y] of surfacePoints.slice(1)) context.lineTo(x, y);
      context.lineTo(w + 5, h + 5);
      context.closePath();
      const accent = parseHex(colorRef.current);
      const liquid = context.createLinearGradient(0, baseY, 0, h);
      liquid.addColorStop(0, rgba(mix(accent, WHITE, .34), .92));
      liquid.addColorStop(.52, rgba(accent, .86));
      liquid.addColorStop(1, rgba(mix(accent, SHADOW, .42), .8));
      context.fillStyle = liquid;
      context.fill();

      context.beginPath();
      context.moveTo(surfacePoints[0][0], surfacePoints[0][1]);
      for (const [x, y] of surfacePoints.slice(1)) context.lineTo(x, y);
      context.lineWidth = 2.2;
      context.strokeStyle = rgba(mix(accent, WHITE, .62), .96);
      context.shadowColor = rgba(accent, .72);
      context.shadowBlur = 5;
      context.stroke();
      context.shadowBlur = 0;

      if (!reducedMotion.matches && fraction > 0.12) {
        const bubbleCount = settled ? 2 : 3;
        const bubblePhase = now * 0.001;
        context.fillStyle = rgba(mix(accent, WHITE, .82), settled ? .34 : .44);
        for (let index = 0; index < bubbleCount; index += 1) {
          const bubbleX = w * (0.3 + index * 0.23) + Math.sin(bubblePhase * .75 + index * 1.7) * 1.6;
          const travel = Math.max(8, h - baseY - 8);
          const bubbleY = h - 5 - ((bubblePhase * (2.5 + index * .42) + index * 9.5) % travel);
          if (bubbleY > baseY + 5) {
            context.beginPath();
            context.arc(bubbleX, bubbleY, .75 + index * .2, 0, Math.PI * 2);
            context.fill();
          }
        }
      }

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      unlisten();
    };
  }, []);

  return <canvas ref={canvasRef} className="orb-liquid-canvas" aria-hidden="true" />;
});

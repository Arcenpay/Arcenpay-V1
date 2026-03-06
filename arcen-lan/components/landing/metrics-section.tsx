"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ── Animated Canvas Line-Art Icon ──────────────────────────────────
// Draws animated vertical lines that form abstract shapes (phone, globe, lock, code)
// Similar to Base.org's animated product cards

interface LineArtProps {
  shape: "contracts" | "accounts" | "chains" | "settlement";
  color: string;
  width?: number;
  height?: number;
}

function AnimatedLineArt({ shape, color, width = 160, height = 140 }: LineArtProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const animRef = useRef<number>(0);

  const drawShape = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
      ctx.clearRect(0, 0, w, h);

      const lineCount = 28;
      const lineSpacing = w / (lineCount + 2);
      const baseX = lineSpacing;

      // Shape masks — each shape defines which lines should be tall
      // and how they form the icon's silhouette
      const getLineHeight = (i: number, phase: number): { y1: number; y2: number; accent: boolean } => {
        const norm = i / lineCount; // 0 to 1

        switch (shape) {
          case "contracts": {
            // Document/contract shape — rectangle with folded corner
            const inBody = norm > 0.15 && norm < 0.85;
            const inFold = norm > 0.6 && norm < 0.85;
            const topEdge = inFold ? h * 0.15 + (norm - 0.6) * h * 0.6 : h * 0.15;
            const bottomEdge = h * 0.85;
            const waveOffset = Math.sin(phase + i * 0.3) * 4;
            if (inBody) {
              return {
                y1: topEdge + waveOffset,
                y2: bottomEdge + waveOffset * 0.5,
                accent: i % 3 === 0,
              };
            }
            return { y1: h * 0.4 + waveOffset, y2: h * 0.6 + waveOffset, accent: false };
          }

          case "accounts": {
            // Shield/account shape — rounded abstract profile
            const cx = 0.5;
            const dist = Math.abs(norm - cx);
            const radius = 0.38;
            if (dist < radius) {
              const circleH = Math.sqrt(radius * radius - dist * dist) * h * 1.4;
              const centerY = h * 0.45;
              const waveOffset = Math.sin(phase + i * 0.25) * 5;
              // Head portion (small circle at top)
              const isHead = dist < 0.12 && norm > 0.38 && norm < 0.62;
              return {
                y1: centerY - circleH * 0.5 + waveOffset + (isHead ? -10 : 0),
                y2: centerY + circleH * 0.5 + waveOffset * 0.3,
                accent: isHead || i % 4 === 0,
              };
            }
            return { y1: h * 0.42, y2: h * 0.48, accent: false };
          }

          case "chains": {
            // Globe/world shape — circle with longitude lines
            const cx = 0.5;
            const dist = Math.abs(norm - cx);
            const radius = 0.42;
            if (dist < radius) {
              const circleH = Math.sqrt(radius * radius - dist * dist) * h * 1.5;
              const centerY = h * 0.5;
              const waveOffset = Math.sin(phase + i * 0.2) * 6;
              // Simulate continent-like density
              const isMeridian = Math.abs(Math.sin(norm * Math.PI * 6 + phase * 0.5)) > 0.7;
              return {
                y1: centerY - circleH * 0.5 + waveOffset,
                y2: centerY + circleH * 0.5 + waveOffset * 0.4,
                accent: isMeridian,
              };
            }
            return { y1: h * 0.45, y2: h * 0.55, accent: false };
          }

          case "settlement": {
            // Tag/payment shape — price tag with circle
            const inBody = norm > 0.1 && norm < 0.8;
            const inPoint = norm >= 0.8 && norm < 0.95;
            const waveOffset = Math.sin(phase + i * 0.35) * 4;
            if (inBody) {
              const topEdge = h * 0.2 + waveOffset;
              const bottomEdge = h * 0.8 + waveOffset * 0.5;
              // Circle cutout for tag hole
              const isHole = norm > 0.18 && norm < 0.32 && Math.abs(Math.sin(phase * 2 + i * 0.5)) > 0.3;
              return { y1: topEdge, y2: bottomEdge, accent: isHole || i % 3 === 1 };
            }
            if (inPoint) {
              const pointProgress = (norm - 0.8) / 0.15;
              const topEdge = h * 0.2 + pointProgress * h * 0.3 + waveOffset;
              const bottomEdge = h * 0.8 - pointProgress * h * 0.3 + waveOffset * 0.5;
              return { y1: topEdge, y2: bottomEdge, accent: false };
            }
            return { y1: h * 0.4 + waveOffset, y2: h * 0.6 + waveOffset, accent: false };
          }

          default:
            return { y1: h * 0.3, y2: h * 0.7, accent: false };
        }
      };

      for (let i = 0; i < lineCount; i++) {
        const x = baseX + i * lineSpacing;
        const { y1, y2, accent } = getLineHeight(i, t);

        // Background line (muted)
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.strokeStyle = `rgba(180, 180, 180, 0.08)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Shape line
        ctx.beginPath();
        ctx.moveTo(x, y1);
        ctx.lineTo(x, y2);
        ctx.strokeStyle = accent ? color : `${color}60`;
        ctx.lineWidth = accent ? 3 : 2;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    },
    [shape, color, height]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);

    const animate = () => {
      frameRef.current += 0.02;
      drawShape(ctx, width, height, frameRef.current);
      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, drawShape]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="opacity-90 transition-opacity duration-300 group-hover:opacity-100"
    />
  );
}

// ── Animated Counter ───────────────────────────────────────────────

function AnimatedCounter({
  end,
  suffix = "",
  prefix = "",
}: {
  end: number;
  suffix?: string;
  prefix?: string;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          const duration = 2000;
          const startTime = performance.now();
          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * end));
            if (progress < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, hasAnimated]);

  return (
    <div ref={ref} className="font-mono text-4xl lg:text-5xl font-bold tracking-tight">
      {prefix}
      {count.toLocaleString()}
      {suffix}
    </div>
  );
}

// ── Metric Data ────────────────────────────────────────────────────

const metrics = [
  {
    value: 7,
    suffix: "",
    label: "smart contracts deployed.",
    sublabel: "SEPOLIA",
    shape: "contracts" as const,
    color: "#3b82f6", // blue
  },
  {
    value: 0,
    suffix: "",
    prefix: "ERC-7579 ",
    displayText: "ERC-7579",
    label: "modular smart accounts.",
    sublabel: "ZERODEV",
    shape: "accounts" as const,
    color: "#ec4899", // pink
  },
  {
    value: 6,
    suffix: "",
    label: "cross-chain entitlements.",
    sublabel: "AXELAR",
    shape: "chains" as const,
    color: "#d4a062", // gold/tan
  },
  {
    value: 0,
    suffix: "",
    prefix: "0.5% ",
    displayText: "0.5%",
    label: "protocol settlement fee.",
    sublabel: "USDC",
    shape: "settlement" as const,
    color: "#60a5fa", // light blue
  },
];

// ── Main Section ───────────────────────────────────────────────────

export function MetricsSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );
    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="metrics"
      ref={sectionRef}
      className="relative py-32 overflow-hidden"
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="mb-16">
          <p className="text-sm font-mono text-primary mb-3">
            // PROTOCOL METRICS
          </p>
          <h2 className="text-3xl lg:text-5xl font-semibold tracking-tight text-balance">
            Real-time protocol
            <br />
            performance.
          </h2>
        </div>

        {/* Animated Icon Cards — Base.org style */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={`group relative bg-gray-50 rounded-2xl p-6 transition-all duration-700 hover:shadow-lg hover:-translate-y-1 cursor-default ${isVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-8"
                }`}
              style={{ transitionDelay: `${index * 120}ms` }}
            >
              {/* Line-art icon */}
              <div className="flex items-center justify-center mb-4">
                <AnimatedLineArt
                  shape={metric.shape}
                  color={metric.color}
                  width={150}
                  height={120}
                />
              </div>

              {/* Label */}
              <p className="text-xs font-mono text-gray-400 uppercase tracking-wider">
                {metric.sublabel}
              </p>
            </div>
          ))}
        </div>

        {/* Dark Metric Cards — matching reference */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden card-shadow">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="bg-[#1a1a1e] p-8 flex flex-col gap-3"
            >
              <div className="text-white">
                {metric.displayText ? (
                  <div className="font-mono text-4xl lg:text-5xl font-bold tracking-tight">
                    {metric.displayText}
                  </div>
                ) : (
                  <AnimatedCounter
                    end={metric.value}
                    suffix={metric.suffix}
                  />
                )}
              </div>
              <div>
                <div className="text-white/70 text-sm">{metric.label}</div>
                <div className="text-xs text-primary font-mono mt-1">
                  {metric.sublabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

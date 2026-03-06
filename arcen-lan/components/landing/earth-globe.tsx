"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import createGlobe from "cobe";

interface EarthGlobeProps {
    className?: string;
}

export function EarthGlobe({ className = "" }: EarthGlobeProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pointerInteracting = useRef<number | null>(null);
    const pointerInteractionMovement = useRef(0);
    const phiRef = useRef(0);
    const widthRef = useRef(0);
    const globeRef = useRef<ReturnType<typeof createGlobe> | null>(null);
    const [scale, setScale] = useState(1);
    const scaleRef = useRef(1);

    const onResize = useCallback(() => {
        if (canvasRef.current) {
            widthRef.current = canvasRef.current.offsetWidth;
        }
    }, []);

    useEffect(() => {
        window.addEventListener("resize", onResize);
        onResize();

        if (!canvasRef.current) return;

        const globe = createGlobe(canvasRef.current, {
            devicePixelRatio: 2,
            width: widthRef.current * 2,
            height: widthRef.current * 2,
            phi: 0,
            theta: 0.3,
            dark: 1,
            diffuse: 1.2,
            mapSamples: 16000,
            mapBrightness: 6,
            baseColor: [0.3, 0.3, 0.3],
            markerColor: [0.016, 0.334, 1], // #0455ff
            glowColor: [0.1, 0.1, 0.1],
            markers: [
                // Highlighted locations representing supported chains/nodes
                { location: [37.7749, -122.4194], size: 0.06 }, // San Francisco
                { location: [40.7128, -74.006], size: 0.06 },   // New York
                { location: [51.5074, -0.1278], size: 0.08 },   // London
                { location: [35.6762, 139.6503], size: 0.06 },   // Tokyo
                { location: [1.3521, 103.8198], size: 0.06 },    // Singapore
                { location: [48.8566, 2.3522], size: 0.05 },     // Paris
                { location: [-33.8688, 151.2093], size: 0.05 },  // Sydney
                { location: [55.7558, 37.6173], size: 0.05 },    // Moscow
                { location: [19.076, 72.8777], size: 0.06 },     // Mumbai
                { location: [-23.5505, -46.6333], size: 0.05 },  // São Paulo
                { location: [25.2048, 55.2708], size: 0.05 },    // Dubai
                { location: [22.3193, 114.1694], size: 0.06 },   // Hong Kong
            ],
            onRender: (state) => {
                // Auto-rotate when not interacting
                if (!pointerInteracting.current) {
                    phiRef.current += 0.005;
                }
                state.phi = phiRef.current + pointerInteractionMovement.current;
                state.width = widthRef.current * 2;
                state.height = widthRef.current * 2;
            },
        });

        globeRef.current = globe;

        // Fade in
        setTimeout(() => {
            if (canvasRef.current) {
                canvasRef.current.style.opacity = "1";
            }
        }, 100);

        return () => {
            globe.destroy();
            window.removeEventListener("resize", onResize);
        };
    }, [onResize]);

    // Handle scroll-to-zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        const newScale = Math.max(0.6, Math.min(2, scaleRef.current + delta));
        scaleRef.current = newScale;
        setScale(newScale);
    }, []);

    return (
        <div className={`relative ${className}`}>
            <div
                style={{
                    width: "100%",
                    maxWidth: 600,
                    aspectRatio: "1",
                    margin: "auto",
                    position: "relative",
                    transform: `scale(${scale})`,
                    transition: "transform 0.1s ease-out",
                }}
            >
                <canvas
                    ref={canvasRef}
                    onPointerDown={(e) => {
                        pointerInteracting.current =
                            e.clientX - pointerInteractionMovement.current;
                        if (canvasRef.current) {
                            canvasRef.current.style.cursor = "grabbing";
                        }
                    }}
                    onPointerUp={() => {
                        pointerInteracting.current = null;
                        if (canvasRef.current) {
                            canvasRef.current.style.cursor = "grab";
                        }
                    }}
                    onPointerOut={() => {
                        pointerInteracting.current = null;
                        if (canvasRef.current) {
                            canvasRef.current.style.cursor = "grab";
                        }
                    }}
                    onMouseMove={(e) => {
                        if (pointerInteracting.current !== null) {
                            const delta = e.clientX - pointerInteracting.current;
                            pointerInteractionMovement.current = delta / 100;
                        }
                    }}
                    onTouchMove={(e) => {
                        if (pointerInteracting.current !== null && e.touches[0]) {
                            const delta =
                                e.touches[0].clientX - pointerInteracting.current;
                            pointerInteractionMovement.current = delta / 100;
                        }
                    }}
                    onWheel={(e) => handleWheel(e)}
                    style={{
                        width: "100%",
                        height: "100%",
                        cursor: "grab",
                        contain: "layout paint size",
                        opacity: 0,
                        transition: "opacity 1s ease",
                    }}
                />
            </div>

            {/* Interaction hint */}
            <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm text-white/70 text-xs font-mono px-3 py-1.5 rounded-md">
                Drag to rotate • Scroll to zoom
            </div>
        </div>
    );
}

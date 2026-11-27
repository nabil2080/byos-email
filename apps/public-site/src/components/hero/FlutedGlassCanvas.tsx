import { onMount, onCleanup } from "solid-js";

interface FlutedGlassCanvasProps {
  class?: string;
}

/**
 * Soft, diffused architectural fluted-glass WebGL shader in the Option 1 palette:
 * Deep Navy-Obsidian (#0B131B), Deep Editorial Blue (#226192), Coral Orange (#EF8557),
 * and Warm Ivory (#EAE6DE) highlights.
 */
export function FlutedGlassCanvas(props: FlutedGlassCanvasProps) {
  let canvasRef: HTMLCanvasElement | undefined;

  onMount(() => {
    const canvas = canvasRef;
    if (!canvas) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return;

    const vertSrc = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fragSrc = `
      precision mediump float;
      varying vec2 v_uv;
      uniform float u_time;
      uniform vec2 u_mouse;
      uniform vec2 u_res;

      float softBlob(vec2 uv, vec2 center, float radius) {
        vec2 d = (uv - center) * vec2(u_res.x / max(u_res.y, 1.0), 1.0);
        return exp(-dot(d, d) / (radius * radius));
      }

      void main() {
        vec2 uv = v_uv;

        // Wide, soft vertical glass flutes (no harsh sharp lines)
        float fluteCount = max(14.0, u_res.x / 58.0);
        float phase = uv.x * fluteCount * 6.2831853;

        float fluteWave = sin(phase);
        float fluteShadow = 0.5 + 0.5 * cos(phase + 0.45);
        float refractX = fluteWave * 0.024;
        float refractY = cos(phase * 0.5 + uv.y * 2.0) * 0.008;

        vec2 ruv = uv + vec2(refractX, refractY);

        float t = u_time * 0.28;
        // Deep Editorial Blue upper-mid bloom, Coral Orange lower-right bloom, mouse spotlight
        vec2 cBlue  = vec2(0.48 + 0.08 * sin(t * 0.8), 0.56 + 0.07 * cos(t * 0.6));
        vec2 cCoral = vec2(0.56 + 0.09 * cos(t * 0.7), 0.22 + 0.07 * sin(t * 0.9));
        vec2 cIvory = vec2(0.84 + 0.05 * sin(t * 0.5), 0.72 + 0.06 * cos(t * 0.5));
        vec2 cm     = u_mouse;

        float bBlue  = softBlob(ruv, cBlue, 0.48);
        float bCoral = softBlob(ruv, cCoral, 0.42);
        float bIvory = softBlob(ruv, cIvory, 0.44);
        float bm     = softBlob(ruv, cm, 0.36);

        vec3 colBg    = vec3(0.043, 0.075, 0.106); // #0B131B deep navy-obsidian
        vec3 colBlue  = vec3(0.133, 0.380, 0.573); // #226192 Deep Editorial Blue
        vec3 colCoral = vec3(0.937, 0.522, 0.341); // #EF8557 Coral Orange
        vec3 colIvory = vec3(0.918, 0.902, 0.871); // #EAE6DE Warm Ivory

        vec3 color = colBg;
        color = mix(color, colBlue,  clamp(bBlue * 0.88 + bm * 0.30, 0.0, 1.0));
        color = mix(color, colCoral, clamp(bCoral * 0.92 + bm * 0.34, 0.0, 1.0));
        color = mix(color, colIvory, clamp(bIvory * 0.24, 0.0, 1.0));

        // Soft diffused ivory glow at peak light intersections
        float coreGlow = clamp(bCoral * 0.55 + bm * 0.42, 0.0, 1.0);
        color += colIvory * pow(coreGlow, 2.5) * 0.24;

        // Smooth sinusoidal fluted-glass shading
        float ribShade = mix(0.62, 1.15, pow(fluteShadow, 1.35));
        color *= ribShade;

        // Soft edge vignette
        float vig = smoothstep(1.18, 0.26, length((uv - 0.5) * vec2(1.15, 1.05)));
        color *= mix(0.58, 1.0, vig);

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        gl.deleteShader(s);
        return null;
      }
      return s;
    };

    const vs = compile(gl.VERTEX_SHADER, vertSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const locPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

    const locTime = gl.getUniformLocation(prog, "u_time");
    const locMouse = gl.getUniformLocation(prog, "u_mouse");
    const locRes = gl.getUniformLocation(prog, "u_res");

    let targetMX = 0.58;
    let targetMY = 0.36;
    let curMX = 0.58;
    let curMY = 0.36;
    let rafId = 0;
    const start = performance.now();

    const resize = () => {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    };

    const renderFrame = (now: number) => {
      resize();
      curMX += (targetMX - curMX) * 0.05;
      curMY += (targetMY - curMY) * 0.05;
      gl.uniform1f(locTime, (now - start) / 1000);
      gl.uniform2f(locMouse, curMX, curMY);
      gl.uniform2f(locRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduce) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetMX = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / rect.width));
      targetMY = Math.max(0.05, Math.min(0.95, 1.0 - (e.clientY - rect.top) / rect.height));
    };

    const parent = canvas.parentElement;
    parent?.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", resize, { passive: true });

    renderFrame(start);

    onCleanup(() => {
      parent?.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      if (rafId) window.cancelAnimationFrame(rafId);
    });
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      class={`pointer-events-none absolute inset-0 h-full w-full ${props.class || ""}`}
    />
  );
}

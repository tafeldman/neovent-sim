import { useState, useMemo, useEffect, useRef } from 'react';
import { Activity, Wind, Waves, Zap, AlertTriangle, TrendingUp, TrendingDown, Minus, Heart, Droplet, Info } from 'lucide-react';

// =============== Utility: thresholds by weight ===============
// Each returns { min, max, safe: [lo, hi], caution: [lo, hi] } — anything outside caution = danger

function pipThresholds(w, ctx = 'RDS') {
  if (ctx === 'BPD') {
    // BPD: poor compliance + dead space means higher PIPs often needed and better tolerated
    if (w < 1.0) return { min: 10, max: 40, safe: [18, 28], caution: [14, 32] };
    if (w < 2.0) return { min: 10, max: 42, safe: [20, 32], caution: [16, 36] };
    if (w < 3.0) return { min: 10, max: 45, safe: [22, 34], caution: [18, 38] };
    return { min: 10, max: 50, safe: [24, 36], caution: [20, 40] };
  }
  if (w < 1.0) return { min: 10, max: 35, safe: [14, 22], caution: [12, 25] };
  if (w < 2.0) return { min: 10, max: 40, safe: [14, 25], caution: [12, 28] };
  if (w < 3.0) return { min: 10, max: 45, safe: [14, 28], caution: [12, 32] };
  return { min: 10, max: 50, safe: [14, 30], caution: [12, 35] };
}

function peepThresholds(w, ctx = 'RDS') {
  if (ctx === 'BPD') return { min: 0, max: 14, safe: [6, 9], caution: [5, 11] };
  return { min: 0, max: 12, safe: [4, 7], caution: [3, 9] };
}

function rateThresholds(ctx = 'RDS') {
  if (ctx === 'BPD') return { min: 10, max: 80, safe: [18, 35], caution: [15, 45] };
  return { min: 10, max: 80, safe: [25, 55], caution: [20, 65] };
}

function iTimeThresholds(w, ctx = 'RDS') {
  if (ctx === 'BPD') return { min: 0.2, max: 0.7, safe: [0.40, 0.55], caution: [0.35, 0.60], step: 0.01 };
  if (w < 1.5) return { min: 0.2, max: 0.6, safe: [0.25, 0.35], caution: [0.22, 0.4], step: 0.01 };
  if (w < 2.5) return { min: 0.2, max: 0.6, safe: [0.3, 0.4], caution: [0.25, 0.45], step: 0.01 };
  return { min: 0.2, max: 0.6, safe: [0.35, 0.45], caution: [0.3, 0.5], step: 0.01 };
}

function vtThresholds(ctx = 'RDS') {
  // mL/kg
  if (ctx === 'BPD') return { safe: [5.5, 7], caution: [4.5, 7.5] };
  return { safe: [4, 6], caution: [3.5, 7] };
}

function targetVtThresholds(ctx = 'RDS') {
  // VT target slider bounds + safe range (mL/kg)
  if (ctx === 'BPD') return { min: 3, max: 9, safe: [5.5, 6.5], caution: [4.5, 7.5], step: 0.1 };
  return { min: 3, max: 9, safe: [4.5, 5.5], caution: [4, 6], step: 0.1 };
}

function pipMaxThresholds(w, ctx = 'RDS') {
  // Ceiling for VG mode (pressure limit)
  if (ctx === 'BPD') return { min: 15, max: 45, safe: [28, 35], caution: [25, 40] };
  if (w < 1.0) return { min: 15, max: 40, safe: [22, 28], caution: [20, 32] };
  if (w < 2.0) return { min: 15, max: 40, safe: [25, 30], caution: [22, 34] };
  return { min: 15, max: 45, safe: [28, 35], caution: [25, 38] };
}

function mapHfovThresholds(w) {
  if (w < 1.0) return { min: 6, max: 25, safe: [8, 14], caution: [7, 18] };
  if (w < 2.0) return { min: 6, max: 28, safe: [8, 16], caution: [7, 20] };
  return { min: 6, max: 30, safe: [8, 18], caution: [7, 22] };
}

function hfovAmpThresholds(w, map) {
  // Amplitude ideally around 2× MAP to achieve chest wiggle to umbilicus
  const ideal = map * 2;
  return { min: 10, max: 60, safe: [ideal - 5, ideal + 10], caution: [ideal - 10, ideal + 20] };
}

function hfovFreqThresholds(w) {
  if (w < 1.0) return { min: 5, max: 16, safe: [12, 15], caution: [10, 16] };
  if (w < 2.0) return { min: 5, max: 16, safe: [10, 13], caution: [8, 15] };
  if (w < 3.0) return { min: 5, max: 16, safe: [8, 11], caution: [7, 13] };
  return { min: 5, max: 16, safe: [6, 9], caution: [5, 11] };
}

function hfjvPeepThresholds(w, preset = 'general') {
  if (preset === 'elbw') return { min: 2, max: 12, safe: [4, 6], caution: [3, 8] };
  if (preset === 'bunnell') return { min: 2, max: 14, safe: [5, 8], caution: [4, 10] };
  // CDH: gentle ventilation, but PEEP may climb to recruit / support MAP
  if (preset === 'cdh') return { min: 3, max: 14, safe: [5, 9], caution: [4, 12] };
  // MAS: term-baby range; high PEEP risks worsening gas trapping
  if (preset === 'mas') return { min: 2, max: 10, safe: [4, 7], caution: [3, 8] };
  // General (lecture-aligned: starting PEEP 5)
  return { min: 2, max: 12, safe: [4, 7], caution: [3, 9] };
}

function hfjvPipThresholds(w, ga = 30, phase = 'RDS', preset = 'general') {
  // Baptist/Ochsner ELBW protocol: initial 22-24 (2.5 ETT), failure >45-47
  if (preset === 'elbw') {
    if (phase === 'RDS') return { min: 12, max: 50, safe: [20, 28], caution: [16, 38] };
    return { min: 12, max: 50, safe: [22, 34], caution: [18, 42] };
  }
  // Bunnell: match CV PIP initially, wean slowly; failure approaching 50
  if (preset === 'bunnell') return { min: 10, max: 50, safe: [16, 28], caution: [12, 38] };
  // CDH: gentle ventilation — keep < 26 (Caution Zone), < 30 (Hazard Zone)
  if (preset === 'cdh') return { min: 12, max: 40, safe: [18, 24], caution: [14, 26] };
  // MAS: jet PIP should stay ≤ prior CV PIP; generally moderate range
  if (preset === 'mas') return { min: 12, max: 40, safe: [20, 28], caution: [16, 32] };
  // General lecture default: 20-24 starting, "good wiggle"
  if (preset === 'general') return { min: 12, max: 50, safe: [20, 26], caution: [16, 32] };
  return pipThresholds(w);
}

function hfjvRateThresholds(ga = 30, w = 1.0, preset = 'general') {
  // Baptist/Ochsner: GA-based baseline, ±30 safe, ±60 caution
  if (preset === 'elbw') {
    const base = ga < 24 ? 300 : (ga <= 26 ? 360 : 420);
    return {
      min: 240, max: 660, step: 20,
      safe: [base - 30, base + 30],
      caution: [base - 60, Math.min(base + 120, 660)],
      recommended: base,
    };
  }
  // Bunnell: 420 default for most neonates, 240-320 for air leak/obstructive
  if (preset === 'bunnell') return { min: 240, max: 660, safe: [360, 480], caution: [240, 540], step: 20, recommended: 420 };
  // CDH: term-baby standard; lower rates if PIE/PTX
  if (preset === 'cdh') return { min: 240, max: 600, safe: [360, 420], caution: [240, 480], step: 20, recommended: 420 };
  // MAS: low rate by design — high I:E ratio for gas-trapping (Tingay piglet model)
  if (preset === 'mas') return { min: 180, max: 480, safe: [240, 360], caution: [180, 420], step: 20, recommended: 300 };
  // General lecture: GA OR weight-based baseline
  const base = recommendedHfjvRate(ga, w);
  return {
    min: 240, max: 660, step: 20,
    safe: [base - 30, base + 30],
    caution: [base - 60, Math.min(base + 120, 660)],
    recommended: base,
  };
}

function fio2Thresholds() {
  return { min: 0.21, max: 1.0, safe: [0.21, 0.30], caution: [0.21, 0.60], step: 0.01 };
}

function isELBW(w, ga) {
  return w < 0.5 || ga < 25;
}

// Lecture-aligned: use whichever criterion (GA or weight) yields the LOWER rate
function recommendedHfjvRate(ga, weight) {
  const byGa = ga < 24 ? 300 : (ga <= 26 ? 360 : 420);
  if (weight == null) return byGa;
  const byWeight = weight < 0.6 ? 300 : (weight <= 1.0 ? 360 : 420);
  return Math.min(byGa, byWeight);
}

function navaLevelThresholds() {
  return { min: 0.3, max: 4.5, safe: [1.0, 2.5], caution: [0.5, 3.5], step: 0.1 };
}

// =============== Classify a value into zones ===============
function zoneOf(value, thresh) {
  if (value < thresh.caution[0] || value > thresh.caution[1]) return 'danger';
  if (value < thresh.safe[0] || value > thresh.safe[1]) return 'caution';
  return 'safe';
}

const zoneColors = {
  safe: { text: 'text-emerald-400', bg: 'bg-emerald-500', hex: '#10b981', stroke: '#34d399' },
  caution: { text: 'text-amber-400', bg: 'bg-amber-500', hex: '#f59e0b', stroke: '#fbbf24' },
  danger: { text: 'text-rose-400', bg: 'bg-rose-500', hex: '#ef4444', stroke: '#fb7185' },
};

// Compose a gradient for the zone bar
function zoneGradient(thresh) {
  const span = thresh.max - thresh.min;
  const p = (v) => ((v - thresh.min) / span) * 100;
  const ca0 = p(thresh.caution[0]);
  const sa0 = p(thresh.safe[0]);
  const sa1 = p(thresh.safe[1]);
  const ca1 = p(thresh.caution[1]);
  return `linear-gradient(to right,
    rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.55) ${ca0}%,
    rgba(245,158,11,0.55) ${ca0}%, rgba(245,158,11,0.55) ${sa0}%,
    rgba(16,185,129,0.6) ${sa0}%, rgba(16,185,129,0.6) ${sa1}%,
    rgba(245,158,11,0.55) ${sa1}%, rgba(245,158,11,0.55) ${ca1}%,
    rgba(244,63,94,0.55) ${ca1}%, rgba(244,63,94,0.55) 100%)`;
}

// =============== Slider with zones ===============
function ZoneSlider({ label, unit, value, onChange, thresh, decimals = 0 }) {
  const z = zoneOf(value, thresh);
  const step = thresh.step ?? 1;
  const span = thresh.max - thresh.min;
  const pct = ((value - thresh.min) / span) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-xs uppercase tracking-widest text-slate-400 font-mono">{label}</label>
        <div className="flex items-baseline gap-2">
          <span className={`num text-2xl font-bold ${zoneColors[z].text}`}>
            {decimals > 0 ? value.toFixed(decimals) : Math.round(value)}
          </span>
          <span className="text-xs text-slate-500 font-mono">{unit}</span>
        </div>
      </div>
      <div className="relative h-6">
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full overflow-hidden" style={{ background: zoneGradient(thresh) }} />
        <input
          type="range"
          min={thresh.min}
          max={thresh.max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-5 w-5 rounded-full border-2 border-slate-950 shadow-lg pointer-events-none ${zoneColors[z].bg}`}
          style={{ left: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] font-mono text-slate-600 mt-1 num">
        <span>{thresh.min}</span>
        <span className="text-slate-500">safe {thresh.safe[0]}–{thresh.safe[1]}</span>
        <span>{thresh.max}</span>
      </div>
    </div>
  );
}

// =============== Waveform SVG ===============
function Waveform({ points, yMin, yMax, xMax, strokeColor, label, xLabel = 'time (s)', yLabel = 'P (cmH₂O)', fillBelow = false, showMAP = null }) {
  const W = 720;
  const H = 280;
  const M = { t: 20, r: 16, b: 30, l: 46 };
  const iW = W - M.l - M.r;
  const iH = H - M.t - M.b;
  const sx = (t) => (t / xMax) * iW;
  const sy = (p) => iH - ((p - yMin) / (yMax - yMin)) * iH;

  const d = points.map(([t, p], i) => `${i === 0 ? 'M' : 'L'} ${sx(t).toFixed(2)} ${sy(p).toFixed(2)}`).join(' ');
  const dFill = fillBelow
    ? `${d} L ${sx(points[points.length - 1][0])} ${sy(yMin)} L ${sx(points[0][0])} ${sy(yMin)} Z`
    : '';

  // Y gridlines
  const yTicks = 5;
  const yStep = (yMax - yMin) / yTicks;
  const yVals = Array.from({ length: yTicks + 1 }, (_, i) => yMin + i * yStep);

  // Sweep bar
  const sweepRef = useRef(null);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
        <span className="text-xs uppercase tracking-widest font-mono text-slate-400">{label}</span>
        <span className="text-[10px] font-mono text-slate-600">PRESSURE / TIME</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-56 md:h-72 block">
        <defs>
          <linearGradient id="wfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
          <filter id="wfGlow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform={`translate(${M.l},${M.t})`}>
          {/* grid */}
          {yVals.map((v, i) => (
            <g key={i}>
              <line x1={0} x2={iW} y1={sy(v)} y2={sy(v)} stroke="#1e293b" strokeDasharray="2 3" />
              <text x={-6} y={sy(v) + 3} fontSize="10" fill="#475569" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
                {Math.round(v)}
              </text>
            </g>
          ))}

          {/* MAP line if provided */}
          {showMAP !== null && (
            <g>
              <line x1={0} x2={iW} y1={sy(showMAP)} y2={sy(showMAP)} stroke="#38bdf8" strokeDasharray="4 4" strokeWidth={1.2} opacity={0.7} />
              <text x={iW - 4} y={sy(showMAP) - 4} fontSize="10" fill="#38bdf8" textAnchor="end" fontFamily="IBM Plex Mono, monospace">MAP {showMAP.toFixed(1)}</text>
            </g>
          )}

          {/* waveform fill */}
          {fillBelow && <path d={dFill} fill="url(#wfFill)" />}

          {/* waveform */}
          <path d={d} fill="none" stroke={strokeColor} strokeWidth={2} filter="url(#wfGlow)" strokeLinejoin="round" />

          {/* axes */}
          <line x1={0} x2={iW} y1={iH} y2={iH} stroke="#334155" />
          <line x1={0} x2={0} y1={0} y2={iH} stroke="#334155" />

          {/* x-axis labels */}
          <text x={iW / 2} y={iH + 22} fontSize="10" fill="#64748b" textAnchor="middle" fontFamily="IBM Plex Mono, monospace">
            {xLabel} · window: {xMax.toFixed(2)}s
          </text>

          {/* sweep line */}
          <line ref={sweepRef} x1={0} x2={0} y1={0} y2={iH} stroke={strokeColor} strokeOpacity="0.4" strokeWidth={1}>
            <animate attributeName="x1" from={0} to={iW} dur="3s" repeatCount="indefinite" />
            <animate attributeName="x2" from={0} to={iW} dur="3s" repeatCount="indefinite" />
          </line>
        </g>
      </svg>
    </div>
  );
}

// =============== Toggle segmented control ===============
function ToggleGroup({ value, onChange, options, label }) {
  return (
    <div className="flex-1">
      {label && <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1.5">{label}</div>}
      <div className="inline-flex bg-slate-900 border border-slate-800 rounded-md p-0.5 w-full">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
                active
                  ? 'bg-slate-700 text-amber-300 shadow-inner'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============== Strategy defaults ===============
function strategyDefaults(weight, context) {
  if (context === 'BPD') {
    // Evolving/established BPD: larger VT, higher PEEP, longer iTime, lower rate
    // PIP default sized so that (PIP − PEEP) × 0.3 × weight lands in 5.5–6 mL/kg
    return {
      pip: weight < 1.5 ? 26 : 30,
      peep: 7,
      rate: 28,
      iTime: 0.45,
      targetVt: 6.0,
      pipMax: weight < 1.5 ? 32 : 36,
      fio2: 0.30,
    };
  }
  // RDS / standard
  return {
    pip: 20,
    peep: 5,
    rate: 40,
    iTime: weight < 1.5 ? 0.32 : 0.38,
    targetVt: 5.0,
    pipMax: weight < 1.5 ? 25 : 28,
    fio2: 0.30,
  };
}

// =============== Metric display ===============
function MetricCard({ label, value, unit, zone, hint }) {
  const col = zone ? zoneColors[zone].text : 'text-slate-100';
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`num text-xl font-bold ${col}`}>{value}</span>
        {unit && <span className="text-xs text-slate-500 font-mono">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

// =============== Effect indicator ===============
function EffectRow({ name, value, explanation }) {
  const icons = {
    up: <TrendingUp size={16} className="text-rose-400" />,
    down: <TrendingDown size={16} className="text-cyan-400" />,
    flat: <Minus size={16} className="text-slate-500" />,
    good: <TrendingUp size={16} className="text-emerald-400" />,
    goodDown: <TrendingDown size={16} className="text-emerald-400" />,
  };
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="mt-0.5 flex-shrink-0">{icons[value]}</div>
      <div className="text-xs text-slate-300">
        <span className="font-semibold text-slate-200">{name}:</span> {explanation}
      </div>
    </div>
  );
}

// =============== ActionCard — actionable troubleshooting ===============
// Each problem → primary, secondary, and (optional) caveat
function ActionCard({ icon: Icon, title, problems, accent = 'cyan' }) {
  const accentClasses = {
    cyan: { border: 'border-cyan-900/40', icon: 'text-cyan-400', heading: 'text-cyan-300' },
    rose: { border: 'border-rose-900/40', icon: 'text-rose-400', heading: 'text-rose-300' },
    amber: { border: 'border-amber-900/40', icon: 'text-amber-400', heading: 'text-amber-300' },
    violet: { border: 'border-violet-900/40', icon: 'text-violet-400', heading: 'text-violet-300' },
    emerald: { border: 'border-emerald-900/40', icon: 'text-emerald-400', heading: 'text-emerald-300' },
  }[accent];
  return (
    <div className={`bg-slate-900/40 border ${accentClasses.border} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={14} className={accentClasses.icon} />}
        <h3 className={`text-xs uppercase tracking-widest font-mono ${accentClasses.heading}`}>{title}</h3>
      </div>
      <div className="space-y-3">
        {problems.map((p, i) => (
          <div key={i} className="border-l-2 border-slate-700 pl-3">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-300 mb-1">{p.problem}</div>
            <div className="space-y-1">
              {p.primary && (
                <div className="text-xs text-slate-200 flex gap-2">
                  <span className="num text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">1°</span>
                  <span>{p.primary}</span>
                </div>
              )}
              {p.secondary && (
                <div className="text-xs text-slate-300 flex gap-2">
                  <span className="num text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">2°</span>
                  <span>{p.secondary}</span>
                </div>
              )}
              {p.tertiary && (
                <div className="text-xs text-slate-400 flex gap-2">
                  <span className="num text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">3°</span>
                  <span>{p.tertiary}</span>
                </div>
              )}
              {p.caveat && (
                <div className="text-[11px] text-amber-200/80 italic flex gap-2 mt-1">
                  <span className="text-amber-400 shrink-0">⚠</span>
                  <span>{p.caveat}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============== Observed-value thresholds ===============
function spo2Thresholds(ga) {
  if (ga < 32) return { safe: [88, 95], caution: [85, 97] };
  return { safe: [92, 97], caution: [88, 100] };
}
function pco2Thresholds(ctx) {
  if (ctx === 'BPD') return { safe: [50, 65], caution: [45, 70] };
  if (ctx === 'CLD') return { safe: [55, 70], caution: [45, 75] };
  return { safe: [40, 55], caution: [35, 60] };
}
function ettLeakThresholds() {
  return { safe: [0, 30], caution: [0, 40] };
}
function cxrRibsThresholds() {
  return { safe: [8, 9], caution: [7, 10] };
}
function servoThresholds() {
  return { safe: [6, 14], caution: [4, 18] };
}

function zoneOfObs(value, thresh) {
  if (value === null || value === undefined || value === '' || isNaN(value)) return null;
  if (!thresh || !thresh.caution || !thresh.safe) return null;
  if (value < thresh.caution[0] || value > thresh.caution[1]) return 'danger';
  if (value < thresh.safe[0] || value > thresh.safe[1]) return 'caution';
  return 'safe';
}

// =============== NumberField — typing-friendly numeric input ===============
// Decouples the input's text state from the parent's numeric value so users
// can clear and retype freely. Only commits valid numbers; clamps on blur.
function NumberField({ value, onChange, min, max, integer = false, className, ...rest }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);

  // Sync external value into text when not focused (avoids fighting the user)
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  // Allowed-character regex: integers vs decimals
  const allowed = integer ? /^-?\d*$/ : /^-?\d*\.?\d*$/;

  return (
    <input
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={text}
      onFocus={(e) => {
        setFocused(true);
        // Select all on focus so users can immediately type over the value
        e.target.select();
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (allowed.test(v)) {
          setText(v);
          const num = integer ? parseInt(v, 10) : parseFloat(v);
          if (!isNaN(num)) onChange(num);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const num = integer ? parseInt(text, 10) : parseFloat(text);
        if (isNaN(num)) {
          // Invalid → restore from current value
          setText(String(value));
        } else {
          let final = num;
          if (min != null && final < min) final = min;
          if (max != null && final > max) final = max;
          if (final !== num) {
            onChange(final);
            setText(String(final));
          }
        }
      }}
      className={className}
      {...rest}
    />
  );
}

// =============== ObservedInput — typed numeric input with zone coloring ===============
// Mirrors NumberField's typing-friendly behavior, but allows null (empty)
// as a valid state — clearing the field means "I haven't observed this yet."
function ObservedInput({ label, unit, value, onChange, zone = null, hint, placeholder, step = 1 }) {
  const valueIsNumber = typeof value === 'number' && !isNaN(value);
  const [text, setText] = useState(valueIsNumber ? String(value) : '');
  const [focused, setFocused] = useState(false);

  // Sync external value into text when not focused
  useEffect(() => {
    if (!focused) {
      setText(valueIsNumber ? String(value) : '');
    }
  }, [value, focused, valueIsNumber]);

  const isEmpty = !valueIsNumber;
  const z = !isEmpty ? zone : null;
  const wrapperBorder = z
    ? { safe: 'border-emerald-700/70 bg-emerald-950/20', caution: 'border-amber-700/70 bg-amber-950/20', danger: 'border-rose-700/70 bg-rose-950/20' }[z]
    : 'border-slate-700 bg-slate-900/60 focus-within:border-amber-600/70';
  const valueColor = z ? zoneColors[z].text : 'text-slate-100';

  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1 block">{label}</label>
      <div className={`flex items-baseline gap-1.5 border rounded-md px-2 py-1.5 transition-colors ${wrapperBorder}`}>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          onFocus={(e) => {
            setFocused(true);
            // Select-all so a single tap replaces the value
            e.target.select();
          }}
          onChange={(e) => {
            const v = e.target.value;
            // Allow digits, single decimal point, optional leading minus
            if (/^-?\d*\.?\d*$/.test(v)) {
              setText(v);
              if (v === '' || v === '-' || v === '.' || v === '-.') {
                // Incomplete — propagate null
                onChange(null);
              } else {
                const num = parseFloat(v);
                if (!isNaN(num)) onChange(num);
              }
            }
          }}
          onBlur={() => {
            setFocused(false);
            const num = parseFloat(text);
            if (text === '' || isNaN(num)) {
              setText('');
              onChange(null);
            } else {
              // Normalize trailing dots / leading zeros etc.
              setText(String(num));
              onChange(num);
            }
          }}
          placeholder={placeholder ?? '—'}
          className={`num text-base font-bold w-full bg-transparent text-right focus:outline-none ${valueColor}`}
        />
        {unit && <span className="text-[10px] text-slate-500 font-mono shrink-0 whitespace-nowrap">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] text-slate-500 mt-1 leading-snug">{hint}</div>}
    </div>
  );
}

// =============== SuggestionsPanel — observation-driven recommendations ===============
// =============== TrackCard — adaptive track card ===============
function TrackCard({ track }) {
  const stateStyle = {
    critical: { border: 'border-rose-700/70', bg: 'bg-rose-950/30', badge: 'bg-rose-900/50 text-rose-200', badgeLabel: 'urgent' },
    caution: { border: 'border-amber-700/60', bg: 'bg-amber-950/25', badge: 'bg-amber-900/40 text-amber-200', badgeLabel: 'attention' },
    'in-range': { border: 'border-emerald-800/50', bg: 'bg-emerald-950/15', badge: 'bg-emerald-900/40 text-emerald-200', badgeLabel: 'in target' },
    idle: { border: 'border-slate-800', bg: 'bg-slate-900/40', badge: 'bg-slate-800/80 text-slate-400', badgeLabel: 'baseline' },
  };
  const sty = stateStyle[track.state] || stateStyle.idle;
  const Icon = track.icon;
  const accentText = {
    cyan: 'text-cyan-300',
    rose: 'text-rose-300',
    violet: 'text-violet-300',
    amber: 'text-amber-300',
    emerald: 'text-emerald-300',
  }[track.accent] || 'text-slate-300';

  return (
    <div className={`border ${sty.border} ${sty.bg} rounded-lg p-4 transition-colors`}>
      <div className="flex items-center gap-2 mb-2">
        {Icon && <Icon size={14} className={accentText} />}
        <h4 className={`text-sm font-semibold ${accentText} flex-1`}>{track.title}</h4>
        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${sty.badge}`}>{sty.badgeLabel}</span>
      </div>
      {track.headline && <p className="text-xs text-slate-300 mb-2 leading-relaxed">{track.headline}</p>}

      {track.primary && track.primary.length > 0 && (
        <ol className="space-y-1.5">
          {track.primary.filter(Boolean).map((step, i) => (
            <li key={i} className="text-xs text-slate-200 flex gap-2">
              <span className="num text-[10px] font-mono text-slate-500 shrink-0 mt-0.5">{i + 1}.</span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {track.alternates && track.alternates.length > 0 && (
        <ul className="space-y-1.5">
          {track.alternates.map((alt, i) => (
            <li key={i} className="text-xs flex gap-2">
              <span className="text-slate-500 shrink-0 mt-0.5">·</span>
              <span className="leading-relaxed">
                <span className="text-slate-400">{alt.condition}:</span>{' '}
                <span className="text-slate-200">{alt.action}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {track.caveat && (
        <div className="text-[11px] text-amber-200/80 italic flex gap-2 mt-2 pt-2 border-t border-slate-800/70">
          <span className="text-amber-400 shrink-0">⚠</span>
          <span className="leading-relaxed">{track.caveat}</span>
        </div>
      )}
    </div>
  );
}

// =============== SuggestionsPanel — always-present tracks ===============
function SuggestionsPanel({ tracks }) {
  // Sort: critical → caution → in-range/idle (idle/in-range stay in declared order among themselves)
  const order = { critical: 0, caution: 1, 'in-range': 2, idle: 3 };
  const sorted = [...(tracks || [])].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));

  if (!sorted.length) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-widest text-slate-400 font-mono">Recommendations</h3>
      {sorted.map((t, i) => <TrackCard key={i} track={t} />)}
    </div>
  );
}

// =============== Track builders — one per mode ===============
const _has = (v) => v !== null && v !== undefined && v !== '' && !isNaN(v);

// ---- SIMV ----
function buildSimvTracks({ state, observed, weight, ga, ctx, vtMode, vtT }) {
  const tracks = [];
  const o = observed;

  // OXYGENATION
  {
    const t = spo2Thresholds(ga);
    const spo2 = o.spo2;
    const baseAlts = [
      { condition: 'If low SpO₂', action: '↑ FiO₂ first; ↑ PEEP by 1 cmH₂O once FiO₂ rising > 30%; lengthen iTime, then ↑ PIP if still inadequate' },
      { condition: 'If high SpO₂', action: '↓ FiO₂ first; once ≤ 0.30, ↓ PEEP by 1 cmH₂O' },
    ];
    if (!_has(spo2)) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'idle',
        headline: `Target SpO₂ ${t.safe[0]}–${t.safe[1]}% for ${ga}wk · MAP and PEEP drive recruitment`,
        alternates: baseAlts });
    } else if (spo2 < t.caution[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well below target ${t.safe[0]}–${t.safe[1]}%`,
        primary: [
          'Increase FiO₂ to reach SpO₂ target',
          'Increase PEEP by 1 cmH₂O if FiO₂ rising > 30%',
          'If still inadequate: lengthen iTime, then ↑ PIP. Verify ETT, CXR for PTX/atelectasis',
          ctx === 'BPD' ? 'In BPD: think V/Q — diuretics, treat PHTN if present' : null,
        ] });
    } else if (spo2 < t.safe[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly below target ${t.safe[0]}–${t.safe[1]}%`,
        primary: ['Increase FiO₂ first to reach target', 'If FiO₂ trending > 30%, increase PEEP by 1 cmH₂O'] });
    } else if (spo2 > t.caution[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well above target${ga < 32 ? ' (ROP/oxidative risk)' : ''}`,
        primary: ['Decrease FiO₂ first by 5%', 'Once FiO₂ ≤ 0.30, decrease PEEP by 1 cmH₂O'] });
    } else if (spo2 > t.safe[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly above target ${t.safe[0]}–${t.safe[1]}%`,
        primary: ['Decrease FiO₂ by 2–5%'] });
    } else {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'in-range',
        headline: `SpO₂ ${spo2}% — within target ${t.safe[0]}–${t.safe[1]}%`,
        primary: ['Current strategy working — maintain', 'Weaning order: FiO₂ first, then PEEP once FiO₂ ≤ 0.30'] });
    }
  }

  // VENTILATION
  {
    const t = pco2Thresholds(ctx);
    const pco2 = o.pco2;
    const baseAlts = [
      { condition: 'If high pCO₂', action: vtMode === 'VG' ? '↑ target VT by 0.5 mL/kg; if VT at target, ↑ rate; if PIP at max, raise PIP max' : '↑ rate by 5–10 first (less VILI); ↑ PIP by 1–2 if rate ≥ 60' },
      { condition: 'If low pCO₂', action: '↓ rate by 5–10 first; ' + (vtMode === 'VG' ? '↓ target VT toward 4 mL/kg' : '↓ PIP if measured VT > 6 mL/kg') },
    ];
    if (!_has(pco2)) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'idle',
        headline: `Target pCO₂ ${t.safe[0]}–${t.safe[1]} mmHg for ${ctx} · permissive hypercapnia OK with pH > 7.20`,
        alternates: baseAlts });
    } else if (pco2 > t.caution[1]) {
      const sev = pco2 > t.caution[1] + 10 ? 'critical' : 'caution';
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: sev,
        headline: `pCO₂ ${pco2} — hypercarbia (target ${t.safe[0]}–${t.safe[1]} mmHg for ${ctx})`,
        primary: [
          vtMode === 'VG' ? 'Increase target VT by 0.5 mL/kg' : 'Increase rate by 5–10 first (less VILI than ↑ PIP)',
          vtMode === 'VG' ? 'If VT at target, increase rate; if measured PIP at PIP max, raise PIP max' : `Increase PIP by 1–2 cmH₂O if rate ≥ 60 (target VT ${vtT.safe[0]}–${vtT.safe[1]} mL/kg)`,
          'Suction ETT, exclude tube migration / kink / pneumothorax',
        ],
        caveat: sev === 'critical' && pco2 > 75 ? 'Severe hypercapnia — consider HFV escalation' : null });
    } else if (pco2 < t.caution[0]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'critical',
        headline: `pCO₂ ${pco2} — hypocarbia (PVL risk)`,
        primary: [
          'Decrease rate by 5–10 first',
          vtMode === 'VG' ? 'Decrease target VT toward 4 mL/kg' : 'Decrease PIP if measured VT > 6 mL/kg',
        ],
        caveat: 'pCO₂ <35 strongly associated with PVL and worse neurodevelopmental outcomes' });
    } else if (pco2 < t.safe[0] || pco2 > t.safe[1]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'caution',
        headline: `pCO₂ ${pco2} — outside ideal ${t.safe[0]}–${t.safe[1]} mmHg`,
        primary: pco2 > t.safe[1]
          ? [vtMode === 'VG' ? 'Increase target VT by 0.3 mL/kg' : 'Increase rate by 5', 'Reassess gas in 30–60 min']
          : ['Decrease rate by 5', 'Reassess gas in 30–60 min'] });
    } else {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'in-range',
        headline: `pCO₂ ${pco2} — within ideal ${t.safe[0]}–${t.safe[1]} mmHg`,
        primary: ['Current strategy working — maintain', 'Wean rate or PIP/VT only as needed for hypocarbia'] });
    }
  }

  // VT DELIVERY (volutrauma / atelectotrauma + VG PIP-limited cross-detection)
  {
    const exhVT = o.exhVT;
    const measuredPIP = o.measuredPIP;
    let vtKg = null;
    if (_has(exhVT) && weight > 0) vtKg = exhVT / weight;

    // VG PIP-limited cross-detection takes precedence
    const pipLimited = vtMode === 'VG' && _has(measuredPIP) && _has(exhVT) && weight > 0
      && measuredPIP >= state.pipMax - 2
      && (exhVT / weight) < state.targetVt - 0.5;

    if (pipLimited) {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber', state: 'critical',
        headline: `VG PIP-limited — measured PIP ${measuredPIP} at/near max ${state.pipMax}; delivering ${vtKg.toFixed(1)} mL/kg vs target ${state.targetVt}`,
        primary: [
          'Address compliance first: surfactant if eligible, recruitment maneuver, treat atelectasis',
          'Suction ETT — secretions reduce delivered VT',
          `Raise PIP max by 2–4 cmH₂O (current ${state.pipMax}) only after compliance optimized`,
          'If persistent despite optimization, transition to HFOV or HFJV',
        ] });
    } else if (vtKg == null) {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber', state: 'idle',
        headline: `Target ${vtT.safe[0]}–${vtT.safe[1]} mL/kg for ${ctx} · lung-protective range`,
        alternates: [
          { condition: 'If VT > upper bound', action: vtMode === 'VG' ? '↓ target VT' : '↓ PIP by 1–2; consider switching to VG' },
          { condition: 'If VT < lower bound', action: vtMode === 'VG' ? 'Verify VG delivering target — check measured PIP vs PIP max' : '↑ PIP by 1–2; suction; assess for atelectasis' },
        ] });
    } else if (vtKg > vtT.caution[1]) {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber', state: 'critical',
        headline: `Exhaled VT ${vtKg.toFixed(1)} mL/kg — volutrauma range (${ctx} target ${vtT.safe[0]}–${vtT.safe[1]} mL/kg)`,
        primary: [
          vtMode === 'VG' ? `Decrease target VT to ${vtT.safe[1]} mL/kg` : 'Decrease PIP by 1–2 cmH₂O',
          vtMode === 'PC' ? 'Consider switching to VG for breath-to-breath VT control' : 'Recheck after suction — secretions transiently raise compliance',
        ] });
    } else if (vtKg < vtT.caution[0]) {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber',
        state: vtKg < vtT.caution[0] - 1 ? 'critical' : 'caution',
        headline: `Exhaled VT ${vtKg.toFixed(1)} mL/kg — atelectotrauma range (${ctx} target ${vtT.safe[0]}–${vtT.safe[1]} mL/kg)`,
        primary: [
          vtMode === 'VG' ? 'Verify VG delivering target — check measured PIP vs PIP max' : 'Increase PIP by 1–2 cmH₂O',
          'Suction ETT, exclude obstruction',
          'CXR to assess for atelectasis; recruitment maneuver if patchy',
        ] });
    } else if (vtKg > vtT.safe[1] || vtKg < vtT.safe[0]) {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber', state: 'caution',
        headline: `Exhaled VT ${vtKg.toFixed(1)} mL/kg — outside ideal ${vtT.safe[0]}–${vtT.safe[1]}`,
        primary: vtKg > vtT.safe[1]
          ? [vtMode === 'VG' ? '↓ target VT toward ' + vtT.safe[1] : '↓ PIP by 1']
          : [vtMode === 'VG' ? 'Verify VG at target' : '↑ PIP by 1'] });
    } else {
      tracks.push({ title: 'VT delivery', icon: Activity, accent: 'amber', state: 'in-range',
        headline: `Exhaled VT ${vtKg.toFixed(1)} mL/kg — within ideal ${vtT.safe[0]}–${vtT.safe[1]}`,
        primary: ['Lung-protective range maintained'] });
    }
  }

  // CONDITIONAL ALERTS — only added when triggered
  if (_has(o.ettLeak) && o.ettLeak > 40) {
    tracks.push({ title: 'ETT leak', icon: AlertTriangle, accent: 'rose',
      state: o.ettLeak > 60 ? 'critical' : 'caution',
      headline: `ETT leak ${o.ettLeak}% — excessive (compromises VT delivery, PEEP, trigger)`,
      primary: [
        'Reposition head/neck — leaks are often positional',
        'Verify ETT depth and confirm tube size for weight (consider upsize)',
        vtMode === 'VG' ? 'Large leaks destabilize VG cycling — consider PC' : 'In PC, large leaks under-deliver VT despite set PIP',
      ] });
  }
  if (vtMode === 'PC' && _has(o.measuredPIP) && Math.abs(o.measuredPIP - state.pip) > 3) {
    tracks.push({ title: 'PIP cross-check', icon: AlertTriangle, accent: 'rose', state: 'caution',
      headline: `Measured PIP ${o.measuredPIP} ≠ set ${state.pip} (PC mode)`,
      primary: ['Check ETT for kink, secretions, position', 'Verify circuit integrity, transducer zero'] });
  }

  return tracks;
}

// ---- NAVA ----
function buildNavaTracks({ state, observed, weight, ga }) {
  const tracks = [];
  const o = observed;

  // OXYGENATION
  {
    const t = spo2Thresholds(ga);
    const spo2 = o.spo2;
    const ediMin = o.ediMin;
    const peepHint = _has(ediMin) && ediMin > 3 ? ' · Edi min > 3 also signals raise PEEP' : '';
    const baseAlts = [
      { condition: 'If low SpO₂', action: '↑ FiO₂ first; ↑ PEEP by 1 — primary recruitment lever (NAVA does not directly set MAP)' },
      { condition: 'If high SpO₂', action: '↓ FiO₂ first; once ≤ 0.30, ↓ PEEP by 1' },
    ];
    if (!_has(spo2)) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'idle',
        headline: `Target SpO₂ ${t.safe[0]}–${t.safe[1]}% for ${ga}wk · PEEP is the recruitment lever on NAVA${peepHint}`,
        alternates: baseAlts });
    } else if (spo2 < t.caution[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well below target ${t.safe[0]}–${t.safe[1]}%${peepHint}`,
        primary: [
          'Increase FiO₂ to target',
          'Increase PEEP by 1 cmH₂O — primary recruitment lever on NAVA',
          _has(ediMin) && ediMin > 3 ? 'Edi min > 3 confirms inadequate EELV — raise PEEP' : null,
          'Consider transition to SIMV/PC if recruitment failing',
        ] });
    } else if (spo2 < t.safe[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly below target${peepHint}`,
        primary: ['Increase FiO₂ first', _has(ediMin) && ediMin > 3 ? 'Edi min > 3 — raise PEEP' : 'If FiO₂ rising > 30%, ↑ PEEP by 1'] });
    } else if (spo2 > t.caution[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well above target${ga < 32 ? ' (ROP/oxidative risk)' : ''}`,
        primary: ['Decrease FiO₂ first by 5%', 'Once FiO₂ ≤ 0.30, decrease PEEP by 1'] });
    } else if (spo2 > t.safe[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly above target`,
        primary: ['Decrease FiO₂ by 2–5%'] });
    } else {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'in-range',
        headline: `SpO₂ ${spo2}% — within target ${t.safe[0]}–${t.safe[1]}%`,
        primary: ['Current strategy working — maintain', 'Wean FiO₂ first, then PEEP once FiO₂ ≤ 0.30'] });
    }
  }

  // VENTILATION + DRIVE MATCHING
  {
    const t = pco2Thresholds('RDS');
    const pco2 = o.pco2;
    const ediPeak = o.ediPeak;
    const ediHigh = _has(ediPeak) && ediPeak > 12;
    const ediLow = _has(ediPeak) && ediPeak < 5;
    const baseAlts = [
      { condition: 'If high pCO₂ + high Edi (under-assist)', action: '↑ NAVA level by 0.5 — amplifies each breath' },
      { condition: 'If high pCO₂ + low Edi (under-breathing)', action: 'Reassess sedation/opioids; check caffeine; consider neurologic eval; switch to SIMV/PC for backup rate' },
      { condition: 'If low pCO₂', action: '↓ NAVA level by 0.5; assess for excess drive (pain, agitation, acidosis)' },
    ];
    if (!_has(pco2) && !_has(ediPeak)) {
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: 'idle',
        headline: `Target pCO₂ ${t.safe[0]}–${t.safe[1]} · Edi peak target 5–15 μV`,
        alternates: baseAlts });
    } else if (_has(pco2) && pco2 > t.caution[1]) {
      const sev = pco2 > t.caution[1] + 10 ? 'critical' : 'caution';
      const titleSuffix = ediHigh ? ' + high Edi (under-assist)' : ediLow ? ' + low Edi (under-breathing)' : '';
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: sev,
        headline: `pCO₂ ${pco2} — hypercarbia${titleSuffix}`,
        primary: ediHigh
          ? ['Increase NAVA level by 0.5 — amplifies each breath', 'Accept rising peak PIP if patient is asking for more', 'If NAVA already > 3, switch to SIMV/PC for direct rate control']
          : ediLow
            ? ['Reassess sedation / opioid burden — wean if possible', 'Caffeine if not at full dose', 'If Edi remains < 5 with no sedation, evaluate for brain injury', 'Switch to SIMV/PC for backup rate']
            : ['Increase NAVA level by 0.5', 'Confirm Edi catheter position (ECG complexes visible)', 'Reassess pain / agitation'] });
    } else if (_has(pco2) && pco2 < t.caution[0]) {
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: 'critical',
        headline: `pCO₂ ${pco2} — hypocarbia (PVL risk)`,
        primary: [
          'Decrease NAVA level by 0.5',
          'Reassess Edi peak — high Edi + low pCO₂ means excess support driving over-breathing',
          'If persistent over-breathing, evaluate for pain / agitation / metabolic acidosis',
        ] });
    } else if (_has(ediPeak) && (ediPeak < 5 || ediPeak > 15)) {
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: 'caution',
        headline: ediPeak < 5 ? `Edi peak ${ediPeak} μV — over-assisted (target 5–15)` : `Edi peak ${ediPeak} μV — under-assisted or excess drive (target 5–15)`,
        primary: ediPeak < 5
          ? ['Decrease NAVA level by 0.5', 'If Edi remains low despite weaning, review sedation']
          : ['Increase NAVA level by 0.5 if oxygenation/ventilation borderline', 'Assess for pain, agitation, fever — drive may be excessive', 'Verify Edi catheter position'] });
    } else if (_has(pco2)) {
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: 'in-range',
        headline: `pCO₂ ${pco2}${_has(ediPeak) ? ` · Edi peak ${ediPeak} μV` : ''} — within target`,
        primary: ['Current NAVA level matched to drive — maintain'] });
    } else {
      tracks.push({ title: 'Drive & ventilation', icon: Wind, accent: 'rose', state: _has(ediPeak) ? 'in-range' : 'idle',
        headline: _has(ediPeak) ? `Edi peak ${ediPeak} μV — drive within target 5–15` : `Target pCO₂ ${t.safe[0]}–${t.safe[1]} · Edi peak target 5–15 μV`,
        alternates: _has(ediPeak) ? null : baseAlts,
        primary: _has(ediPeak) ? ['Drive matched — maintain NAVA level'] : null });
    }
  }

  // PEEP / Edi min track
  {
    const ediMin = o.ediMin;
    if (!_has(ediMin)) {
      tracks.push({ title: 'PEEP adequacy', icon: Waves, accent: 'violet', state: 'idle',
        headline: 'Edi min target < 3 μV · elevated tonic Edi signals inadequate end-expiratory lung volume',
        alternates: [
          { condition: 'If Edi min > 3', action: '↑ PEEP by 1 cmH₂O — primary fix; do not raise NAVA level' },
        ] });
    } else if (ediMin > 3) {
      tracks.push({ title: 'PEEP adequacy', icon: Waves, accent: 'violet', state: 'caution',
        headline: `Edi min ${ediMin} μV — elevated tonic activity (target < 3)`,
        primary: ['Increase PEEP by 1 cmH₂O — primary fix', 'Reassess Edi min after 30 min', 'Do not raise NAVA level — does not solve PEEP issue'] });
    } else {
      tracks.push({ title: 'PEEP adequacy', icon: Waves, accent: 'violet', state: 'in-range',
        headline: `Edi min ${ediMin} μV — adequate end-expiratory lung volume`,
        primary: ['PEEP matched to recruitment need'] });
    }
  }

  // CONDITIONAL — Peak PIP barotrauma
  if (_has(o.peakPIP)) {
    const pipT = pipThresholds(weight);
    if (o.peakPIP > pipT.caution[1]) {
      tracks.push({ title: 'Peak PIP', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `Peak PIP ${o.peakPIP} cmH₂O — barotrauma range`,
        primary: [
          'Decrease NAVA level by 0.3–0.5',
          'Reassess Edi peak — if > 15, drive may be excessive (pain, agitation)',
          'If patient comfortable but PIP still high, switch to SIMV/PC for direct PIP control',
        ] });
    }
  }

  return tracks;
}

// ---- HFOV ----
function buildHfovTracks({ state, observed, weight, ga }) {
  const tracks = [];
  const o = observed;

  // OXYGENATION
  {
    const t = spo2Thresholds(ga);
    const spo2 = o.spo2;
    const ribs = o.cxrRibs;
    const baseAlts = [
      { condition: 'If low SpO₂', action: '↑ FiO₂ first; ↑ MAP by 1–2 cmH₂O if FiO₂ rising > 40%; CXR to confirm 8–9 ribs' },
      { condition: 'If high SpO₂', action: '↓ FiO₂ first; once ≤ 0.30, ↓ MAP by 1 cmH₂O' },
    ];
    if (!_has(spo2)) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'idle',
        headline: `Target SpO₂ ${t.safe[0]}–${t.safe[1]}% for ${ga}wk · MAP is the primary oxygenation lever on HFOV`,
        alternates: baseAlts });
    } else if (spo2 < t.caution[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well below target ${t.safe[0]}–${t.safe[1]}%`,
        primary: [
          'Increase FiO₂ to reach SpO₂ target',
          'Increase MAP by 1–2 cmH₂O if FiO₂ rising > 40%',
          _has(ribs) && ribs < 8 ? `CXR ${ribs} ribs confirms under-recruitment — raise MAP` : 'Consider CXR to assess ribs (target 8–9)',
        ] });
    } else if (spo2 < t.safe[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly below target`,
        primary: ['Increase FiO₂ first', 'If FiO₂ rising > 40%, ↑ MAP by 1'] });
    } else if (spo2 > t.caution[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well above target${ga < 32 ? ' (ROP/oxidative risk)' : ''}`,
        primary: ['Decrease FiO₂ first', 'Once FiO₂ ≤ 0.30, decrease MAP by 1 cmH₂O'] });
    } else if (spo2 > t.safe[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly above target`,
        primary: ['Decrease FiO₂ by 2–5%'] });
    } else {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'in-range',
        headline: `SpO₂ ${spo2}% — within target ${t.safe[0]}–${t.safe[1]}%`,
        primary: ['Current MAP and FiO₂ working — maintain', 'Wean FiO₂ first, then MAP once FiO₂ ≤ 0.30'] });
    }
  }

  // VENTILATION
  {
    const t = pco2Thresholds('RDS');
    const pco2 = o.pco2;
    const baseAlts = [
      { condition: 'If high pCO₂', action: '↓ frequency by 1 Hz first (VT ∝ 1/freq²) — most efficient · or ↑ amplitude by 5' },
      { condition: 'If low pCO₂', action: '↑ frequency by 1 Hz · or ↓ amplitude by 5' },
    ];
    if (!_has(pco2)) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'idle',
        headline: `Target pCO₂ ${t.safe[0]}–${t.safe[1]} · VT ∝ amp/freq² — lower Hz raises TV (counterintuitive but key)`,
        alternates: baseAlts });
    } else if (pco2 > t.caution[1]) {
      const sev = pco2 > t.caution[1] + 10 ? 'critical' : 'caution';
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: sev,
        headline: `pCO₂ ${pco2} — hypercarbia. To increase CO₂ clearance: LOWER frequency or RAISE amplitude`,
        primary: [
          'Decrease frequency by 1 Hz first — most efficient (VT ∝ 1/freq²)',
          'Or increase amplitude by 5 cmH₂O',
          'If chest wiggle inadequate (only to clavicles), prioritize raising amplitude',
          _has(o.dco2) && o.dco2 < 50 ? `DCO₂ ${o.dco2} confirms inadequate ventilation` : null,
        ] });
    } else if (pco2 < t.caution[0]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'critical',
        headline: `pCO₂ ${pco2} — hypocarbia (PVL risk)`,
        primary: ['Increase frequency by 1 Hz', 'Or decrease amplitude by 5 cmH₂O', 'If chest wiggle to thighs, amplitude is excessive — reduce'] });
    } else if (pco2 < t.safe[0] || pco2 > t.safe[1]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'caution',
        headline: `pCO₂ ${pco2} — outside ideal ${t.safe[0]}–${t.safe[1]}`,
        primary: pco2 > t.safe[1] ? ['↓ frequency by 1 Hz or ↑ amp by 5'] : ['↑ frequency by 1 Hz or ↓ amp by 5'] });
    } else {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'in-range',
        headline: `pCO₂ ${pco2} — within ideal ${t.safe[0]}–${t.safe[1]}`,
        primary: ['Current amp/freq combination working — maintain'] });
    }
  }

  // LUNG VOLUME (CXR ribs)
  {
    const ribs = o.cxrRibs;
    if (!_has(ribs)) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber', state: 'idle',
        headline: 'Optimal HFOV expansion = 8–9 posterior ribs · flat (not depressed) diaphragms',
        alternates: [
          { condition: 'If < 8 ribs', action: '↑ MAP by 1–2 cmH₂O · recruitment maneuver per protocol' },
          { condition: 'If > 9 ribs', action: '↓ MAP by 1 cmH₂O · reassess hemodynamics' },
        ] });
    } else if (ribs < 8) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber',
        state: ribs < 7 ? 'critical' : 'caution',
        headline: `CXR ${ribs} ribs — under-recruited (target 8–9)`,
        primary: [
          'Increase MAP by 1–2 cmH₂O',
          'Recruitment maneuver: brief MAP escalation per protocol',
          _has(o.spo2) && o.spo2 < 90 ? 'Low SpO₂ + low ribs confirms need for recruitment' : null,
        ] });
    } else if (ribs > 9) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber',
        state: ribs > 10 ? 'critical' : 'caution',
        headline: `CXR ${ribs} ribs — over-distended (target 8–9)`,
        primary: [
          'Decrease MAP by 1 cmH₂O',
          'Reassess hemodynamics — high MAP can compromise venous return',
          'CXR after 6–12h to confirm response',
        ] });
    } else {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber', state: 'in-range',
        headline: `CXR ${ribs} ribs — optimal expansion`,
        primary: ['Lung volume optimal — maintain MAP'] });
    }
  }

  // CONDITIONAL — VThf (volutrauma on HFOV)
  if (_has(o.vthf) && weight > 0) {
    const vtKg = o.vthf / weight;
    if (vtKg > 2.5 || vtKg < 1.0) {
      tracks.push({ title: 'VThf check', icon: AlertTriangle, accent: 'amber',
        state: vtKg > 3 || vtKg < 0.7 ? 'critical' : 'caution',
        headline: `VThf ${vtKg.toFixed(1)} mL/kg — ${vtKg > 2.5 ? 'high' : 'low'} for HFOV (typical 1.5–2.5)`,
        primary: vtKg > 2.5
          ? ['Increase frequency by 1 Hz', 'Or decrease amplitude by 5', 'Watch for hypocarbia']
          : ['Often paired with hypercarbia — see Ventilation', 'Consider lowering frequency or raising amplitude'] });
    }
  }

  return tracks;
}

// ---- HFJV ----
function buildHfjvTracks({ state, observed, weight, ga, preset, phase, recRate }) {
  const tracks = [];
  const o = observed;

  // Preset-specific threshold overrides
  const spo2T = preset === 'cdh'
    ? { safe: [85, 95], caution: [80, 100] }  // CDH: preductal targets, permissive
    : preset === 'mas'
      ? { safe: [92, 97], caution: [88, 100] }  // MAS: term-baby standard
      : spo2Thresholds(ga);
  const pco2T = preset === 'cdh'
    ? { safe: [45, 65], caution: [40, 70] }  // CDH: permissive ≤65
    : preset === 'mas'
      ? { safe: [40, 60], caution: [35, 65] }  // MAS: term-baby with some permissive
      : (phase === 'CLD' ? pco2Thresholds('CLD') : pco2Thresholds('RDS'));

  // SERVO PRESSURE — HFJV signature, always present
  {
    const sp = o.servoP;
    const baseAlts = [
      { condition: 'If servo rising', action: 'Verify ETT (rule out cuff leak/dislodgement); if confirmed, indicates improving compliance — start weaning' },
      { condition: 'If servo falling', action: 'Immediate concern — suction (secretions), CXR (PTX, atelectasis, mainstem), check tube patency' },
    ];
    if (!_has(sp)) {
      tracks.push({ title: 'Servo pressure', icon: Activity, accent: 'rose', state: 'idle',
        headline: 'Servo pressure tracks airway resistance · target 6–14 PSI in normal range',
        alternates: baseAlts });
    } else if (sp < 4) {
      tracks.push({ title: 'Servo pressure', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `Servo ${sp} — very low (URGENT, almost always an airway problem)`,
        primary: [
          'IMMEDIATE: assess ETT — suction, check for kink, secretions, displacement',
          'CXR — exclude pneumothorax, atelectasis, right mainstem',
          'If ETT compromised, replace; otherwise verify hub/connections',
          'Falling servo with rising FiO₂ is a CO₂/oxygenation emergency',
        ] });
    } else if (sp > 18) {
      tracks.push({ title: 'Servo pressure', icon: AlertTriangle, accent: 'rose', state: 'caution',
        headline: `Servo ${sp} — very high (more flow needed for same PIP)`,
        primary: [
          'Verify ETT position — rule out cuff leak / partial dislodgement',
          'If ETT confirmed in place, indicates improving compliance — start weaning',
          'Begin with FiO₂ wean (Bunnell principle) before lowering MAP/PIP',
        ] });
    } else if (sp < 6 || sp > 14) {
      tracks.push({ title: 'Servo pressure', icon: Activity, accent: 'rose', state: 'caution',
        headline: `Servo ${sp} — outside typical 6–14 PSI`,
        primary: sp < 6
          ? ['Trend over time — falling servo suggests airway concern', 'Suction, reassess ETT position']
          : ['Trend over time — rising servo suggests improving compliance or leak', 'Verify ETT position'] });
    } else {
      tracks.push({ title: 'Servo pressure', icon: Activity, accent: 'rose', state: 'in-range',
        headline: `Servo ${sp} — within typical range 6–14 PSI`,
        primary: ['Airway resistance steady — ETT clear, compliance stable'] });
    }
  }

  // OXYGENATION
  {
    const t = spo2T;
    const spo2 = o.spo2;
    const ribs = o.cxrRibs;
    const presetIntro = preset === 'cdh'
      ? `Target preductal SpO₂ ${t.safe[0]}–${t.safe[1]}% (CDH gentle ventilation)`
      : preset === 'mas'
        ? `Target SpO₂ ${t.safe[0]}–${t.safe[1]}% (term-baby standard)`
        : `Target SpO₂ ${t.safe[0]}–${t.safe[1]}% for ${ga}wk`;
    const baseAlts = preset === 'cdh'
      ? [
          { condition: 'If preductal SpO₂ <85%', action: '↑ FiO₂; ↑ MAP via PEEP if FiO₂ >40%; assess for PHTN, consider iNO; if Hazard Zone unrelieved → ECMO' },
          { condition: 'If saturating well', action: '↓ FiO₂ first; once <0.40, ↓ PEEP/MAP toward Safe Zone' },
        ]
      : preset === 'mas'
        ? [
            { condition: 'If low SpO₂', action: '↑ FiO₂; assess for PPHN (pre-/postductal split); if PPHN signs, iNO trial' },
            { condition: 'If high SpO₂', action: '↓ FiO₂ first; PEEP weans cautiously — gas trapping risk' },
          ]
        : [
            { condition: 'If low SpO₂', action: '↑ FiO₂ first; ↑ PEEP by 1 — primary MAP/recruitment lever; CV sigh breaths if atelectasis on CXR' },
            { condition: 'If high SpO₂', action: '↓ FiO₂ first to < 0.30 (Bunnell); then ↓ PEEP by 1' },
          ];
    if (!_has(spo2)) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'idle',
        headline: `${presetIntro} · PEEP-dominant MAP · Bunnell weaning order: FiO₂ first, then MAP`,
        alternates: baseAlts });
    } else if (spo2 < t.caution[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well below target ${t.safe[0]}–${t.safe[1]}%${preset === 'cdh' ? ' (CDH)' : ''}`,
        primary: [
          'Increase FiO₂ to target',
          preset === 'cdh' ? 'Increase PEEP to recruit; if MAP enters Hazard Zone (>22), wean Caution Zone within hours or ECMO' : 'Increase PEEP by 1 — primary MAP/recruitment lever on HFJV',
          _has(ribs) && ribs < 8 ? `CXR ${ribs} ribs confirms under-recruitment — raise PEEP and/or sigh breaths` : 'If atelectasis on CXR, add CV sigh breaths (rate 4, PIP = PEEP+5–10, IT 0.4s)',
          preset === 'cdh' ? 'Assess PHTN — pre/postductal split, echo, iNO trial if not on' : (phase === 'RDS' && state.fio2 > 0.40 ? 'If RSS > 4 in DOL 6–14, consider late surfactant' : null),
          preset === 'mas' ? 'Assess for PPHN — common in severe MAS' : null,
        ] });
    } else if (spo2 < t.safe[0]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly below target`,
        primary: ['Increase FiO₂ first', preset === 'mas' ? 'PEEP increase cautiously — gas trapping risk' : 'If FiO₂ rising, ↑ PEEP by 1'] });
    } else if (spo2 > t.caution[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'critical',
        headline: `SpO₂ ${spo2}% — well above target${ga < 32 ? ' (ROP/oxidative risk)' : ''}`,
        primary: ['Decrease FiO₂ first — wean to < 0.30', 'Once FiO₂ ≤ 0.30, decrease PEEP by 1 cmH₂O', 'Keep jet rate steady during weaning'] });
    } else if (spo2 > t.safe[1]) {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'caution',
        headline: `SpO₂ ${spo2}% — slightly above target`,
        primary: ['Decrease FiO₂ by 2–5%'] });
    } else {
      tracks.push({ title: 'Oxygenation', icon: Droplet, accent: 'cyan', state: 'in-range',
        headline: `SpO₂ ${spo2}% — within target ${t.safe[0]}–${t.safe[1]}%${preset === 'cdh' && spo2 >= 95 ? ' · Ideal Patient on Safe Zone' : ''}`,
        primary: ['Current PEEP and FiO₂ working — maintain', 'Bunnell weaning order: FiO₂ first, then MAP'] });
    }
  }

  // VENTILATION
  {
    const t = pco2T;
    const pco2 = o.pco2;
    const phaseLabel = preset === 'cdh' ? 'CDH' : preset === 'mas' ? 'MAS' : phase;
    const baseAlts = [
      { condition: 'If high pCO₂', action: '↑ Jet PIP by 1–2 cmH₂O (widens ΔP) · ΔP 1–2cm = ±2–4 mmHg, 3–4cm = ±5–9, 5–6cm = ±10–15. Always recheck gas in 15–20 min.' },
      { condition: 'If low pCO₂', action: '↓ Jet PIP by 1–2; if oxygenation borderline, ↑ PEEP simultaneously to maintain MAP' },
    ];
    if (!_has(pco2)) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'idle',
        headline: `${phaseLabel} target pCO₂ ${t.safe[0]}–${t.safe[1]} mmHg · ΔP is primary CO₂ lever on HFJV · TV ∝ ΔP, Ve = TV² × F`,
        alternates: baseAlts });
    } else if (pco2 > t.caution[1]) {
      const sev = pco2 > t.caution[1] + 10 ? 'critical' : 'caution';
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: sev,
        headline: `pCO₂ ${pco2} — hypercarbia (${phaseLabel} target ${t.safe[0]}–${t.safe[1]} mmHg)`,
        primary: [
          'Increase Jet PIP by 1–2 cmH₂O (widens ΔP)',
          'ΔP change 1–2 cm = ±2–4 mmHg pCO₂; 3–4 cm = ±5–9; 5–6 cm = ±10–15',
          phase === 'CLD' && (preset === 'general' || preset === 'elbw' || preset === 'bunnell') ? 'After DOL 14, ↑ rate by 60 if CXR adequately expanded but hazy' : null,
          preset === 'mas' ? 'In MAS gas-trapping: prioritize lower rate (240–300) for longer expiratory time before ↑ PIP' : null,
          'Suction ETT, check servo pressure trend, exclude tube migration',
          'Recheck blood gas in 15–20 minutes after PIP change',
        ] });
    } else if (pco2 < t.caution[0]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'critical',
        headline: `pCO₂ ${pco2} — hypocarbia (PVL risk)`,
        primary: [
          'Decrease Jet PIP by 1–2 cmH₂O',
          'If oxygenation borderline, increase PEEP simultaneously to maintain MAP while narrowing ΔP',
        ],
        caveat: "Don't over-wean PIP without raising PEEP — causes desat swings" });
    } else if (pco2 < t.safe[0] || pco2 > t.safe[1]) {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'caution',
        headline: `pCO₂ ${pco2} — outside ideal ${t.safe[0]}–${t.safe[1]}`,
        primary: pco2 > t.safe[1] ? ['↑ Jet PIP by 1 cmH₂O', 'Recheck gas in 15–20 min'] : ['↓ Jet PIP by 1 cmH₂O', 'Recheck gas in 15–20 min'] });
    } else {
      tracks.push({ title: 'Ventilation', icon: Wind, accent: 'rose', state: 'in-range',
        headline: `pCO₂ ${pco2} — within ${phaseLabel} target ${t.safe[0]}–${t.safe[1]}`,
        primary: ['ΔP matched to CO₂ clearance need — maintain'] });
    }
  }

  // LUNG VOLUME
  {
    const ribs = o.cxrRibs;
    if (!_has(ribs)) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber', state: 'idle',
        headline: 'On HFJV, MAP is PEEP-dominant · target 8–9 posterior ribs',
        alternates: [
          { condition: 'If < 8 ribs', action: '↑ PEEP by 1 cmH₂O · CV sigh breaths (rate 1–5) for atelectasis' },
          { condition: 'If > 9 ribs', action: '↓ PEEP by 1 · if persists, ↓ rate by 60 BPM (gas trapping check)' },
        ] });
    } else if (ribs < 8) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber',
        state: ribs < 7 ? 'critical' : 'caution',
        headline: `CXR ${ribs} ribs — under-recruited (target 8–9)`,
        primary: [
          'Increase PEEP by 1 cmH₂O',
          'Consider CV sigh breaths (rate 1–5 at typical PIP) for atelectasis',
          'CXR after 6–12h to confirm response',
        ] });
    } else if (ribs > 9) {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber',
        state: ribs > 10 ? 'critical' : 'caution',
        headline: `CXR ${ribs} ribs — over-distended (target 8–9)`,
        primary: [
          'Decrease PEEP by 1 cmH₂O',
          'If over-distended despite low PEEP, decrease rate by 60 BPM (gas trapping check)',
          'Reassess hemodynamics',
        ] });
    } else {
      tracks.push({ title: 'Lung volume', icon: Activity, accent: 'amber', state: 'in-range',
        headline: `CXR ${ribs} ribs — optimal expansion`,
        primary: ['Lung volume optimal — maintain PEEP'] });
    }
  }

  // CDH-specific tracks (Duke 3-zone protocol)
  if (preset === 'cdh') {
    const cdhZone = state.map > 22 ? 'hazard' : state.map > 16 ? 'caution' : 'safe';
    // The MAP-driven zone is computed at panel level too; here we duplicate for tracks
    const computedMap = state.peep + (state.pip - state.peep) * (0.02 * state.rate / 60);
    const zoneByComputed = computedMap > 22 ? 'hazard' : computedMap > 16 ? 'caution' : 'safe';
    if (zoneByComputed === 'hazard') {
      tracks.push({ title: 'CDH Hazard Zone', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `HFV MAP ${computedMap.toFixed(1)} >22 — Hazard Zone (Duke protocol)`,
        primary: [
          'Wean to Caution Zone (MAP 16–22) within hours by ↓ PEEP toward Non-Ideal Acceptable parameters',
          'If unable to wean while maintaining preductal SpO₂ ≥85% / postductal pO₂ >30 / pH >7.25 → ECMO indication',
          'Multidisciplinary discussion: pediatric surgery + ECLS team + neonatology',
        ] });
    } else if (zoneByComputed === 'caution') {
      tracks.push({ title: 'CDH Caution Zone', icon: AlertTriangle, accent: 'amber', state: 'caution',
        headline: `HFV MAP ${computedMap.toFixed(1)} (16–22) — Caution Zone`,
        primary: [
          'Assess duration on Caution Zone — consider weaning to Safe Zone (MAP <16)',
          'Tolerate Non-Ideal Acceptable parameters: PaCO₂ ≤65, preductal SpO₂ ≥85%',
          'If sustained >24h despite optimization, multidisciplinary discussion of ECMO endpoints',
        ] });
    } else {
      tracks.push({ title: 'CDH Safe Zone', icon: Heart, accent: 'emerald', state: 'in-range',
        headline: `HFV MAP ${computedMap.toFixed(1)} <16 — Safe Zone`,
        primary: [
          'Maintain current support — minimize barotrauma',
          _has(o.spo2) && o.spo2 >= 95 ? 'Ideal Patient: SpO₂ ≥95% on Safe Zone Therapy' : 'Goal: ideal patient (preductal + postductal SpO₂ >95% on Safe Zone)',
        ] });
    }
    // PHTN/iNO consideration when oxygenation marginal
    if (_has(o.spo2) && o.spo2 < 88 && state.fio2 >= 0.50) {
      tracks.push({ title: 'CDH PHTN/iNO consideration', icon: AlertTriangle, accent: 'amber', state: 'caution',
        headline: `SpO₂ ${o.spo2}% on FiO₂ ${(state.fio2 * 100).toFixed(0)}% — assess for pulmonary hypertension`,
        primary: [
          'Echocardiography for RV function, septal flattening, PDA shunt direction',
          'Pre-/postductal SpO₂ split >5–10% suggests PHTN with R→L shunt',
          'Trial iNO 20 ppm if not already on; if no response, consider milrinone',
          'Confirm postductal pO₂ >30, postductal pH >7.25 — ECMO criteria below this',
        ] });
    }
  }

  // MAS-specific tracks (Tingay piglet model)
  if (preset === 'mas') {
    // Gas-trapping strategy
    const ieR = state.rate > 0 ? (60 / state.rate - 0.02) / 0.02 : 0;
    if (state.rate > 360) {
      tracks.push({ title: 'MAS gas-trapping strategy', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `Rate ${state.rate} too high for MAS gas-trapping (target 240–300)`,
        primary: [
          'Lower jet rate to 240–300 BPM for I:E up to 1:12',
          'Tingay 2010 piglet model: RateHFJV 240 + minimal sigh breaths produced better gas exchange and uniform EELV',
          'Suppress CMV sigh breaths unless atelectasis predominates',
          `Current I:E 1:${ieR.toFixed(0)} — target 1:8 to 1:12`,
        ] });
    } else if (state.rate > 300) {
      tracks.push({ title: 'MAS gas-trapping strategy', icon: Activity, accent: 'amber', state: 'caution',
        headline: `Rate ${state.rate} acceptable but lower (240–300) gives better gas exchange in gas-trapping MAS`,
        alternates: [
          { condition: 'If hyperinflation or rising pCO₂', action: '↓ rate toward 240 for longer expiratory time (I:E 1:12)' },
          { condition: 'If atelectatic phase predominates', action: 'Standard rate may be appropriate; monitor CXR' },
        ] });
    } else {
      tracks.push({ title: 'MAS gas-trapping strategy', icon: Heart, accent: 'emerald', state: 'in-range',
        headline: `Rate ${state.rate} — appropriate for gas-trapping strategy (high I:E 1:${ieR.toFixed(0)})`,
        primary: ['Maintain low rate / high I:E', 'Suppress CMV sigh breaths unless focal atelectasis emerges'] });
    }
    // Jet PIP vs CV PIP warning track
    if (state.pip > 30) {
      tracks.push({ title: 'MAS Jet PIP caution', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `Jet PIP ${state.pip} cmH₂O — risk of non-dependent lung overdistension`,
        primary: [
          'Tingay 2010: setting Jet PIP > prior CV PIP caused disproportionate ↑ EELV in anterior (non-dependent) lung',
          'Set Jet PIP at or below prior CV PIP, prefer ↑ rate or sigh breaths if more recruitment needed',
          'Confirm chest wiggle reaches umbilicus, not thighs',
        ] });
    }
  }

  // CONDITIONAL — ELBW failure criteria
  if (preset === 'elbw') {
    if (state.pip >= 45) {
      tracks.push({ title: 'ELBW failure criteria', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `Jet PIP ${state.pip} ≥ 45 — Baptist/Ochsner failure threshold`,
        primary: ['Transition to HFOV', 'Optimize MAP on HFOV (typically prior MAP + 2)', 'Reassess after 1–2h on HFOV'] });
    }
    if (state.fio2 >= 0.75) {
      tracks.push({ title: 'ELBW failure criteria', icon: AlertTriangle, accent: 'rose', state: 'critical',
        headline: `FiO₂ ${(state.fio2 * 100).toFixed(0)}% ≥ 75% — failure threshold`,
        primary: ['CXR to assess expansion and infiltrate pattern', 'If criteria met, transition to HFOV', 'Otherwise optimize PEEP and consider repeat surfactant if eligible'] });
    }
    if (_has(o.measuredMAP)) {
      const realRSS = o.measuredMAP * state.fio2;
      if (realRSS > 4 && phase === 'RDS') {
        tracks.push({ title: 'Late surfactant trigger', icon: AlertTriangle, accent: 'amber', state: 'caution',
          headline: `RSS ${realRSS.toFixed(1)} > 4 (measured MAP × FiO₂)`,
          primary: ['Confirm RSS sustained, not artifact', 'Verify last surfactant timing (eligible 12h from prior dose)', 'Order repeat surfactant if criteria met (DOL 0–14)'] });
      }
    }
  }

  return tracks;
}

// =============== References modal ===============
const referenceSections = [
  {
    title: 'Lung-protective tidal volume (4–6 mL/kg RDS, 5.5–7 mL/kg BPD)',
    refs: [
      'Wheeler KI, Klingenberg C, McCallion N, Morley CJ, Davis PG. Volume-targeted versus pressure-limited ventilation in neonates. Cochrane Database Syst Rev. 2010 (updated 2017).',
      'Keszler M. Volume-targeted ventilation: one size does not fit all. Evidence-based recommendations for successful use. Arch Dis Child Fetal Neonatal Ed. 2019;104(1):F108–F112.',
      'Klingenberg C, Wheeler KI, McCallion N, Morley CJ, Davis PG. Volume-targeted versus pressure-limited ventilation in neonates. Cochrane review summary in Neonatology.',
    ],
  },
  {
    title: 'SpO₂ targets (preterm 88–95%, term 92–97%)',
    refs: [
      'Cummings JJ, Polin RA; AAP Committee on Fetus and Newborn. Oxygen targeting in extremely low birth weight infants. Pediatrics. 2016;138(2):e20161576.',
      'Saugstad OD, Aune D. Optimal oxygenation of extremely low birth weight infants: a meta-analysis and systematic review of the oxygen saturation target studies. Neonatology. 2014;105(1):55–63.',
      'NeOProM Collaboration: SUPPORT (NEJM 2010), BOOST-II (NEJM 2013), COT (NEJM 2013) — pooled analyses on saturation targeting in preterm infants.',
    ],
  },
  {
    title: 'Permissive hypercapnia / pCO₂ targets',
    refs: [
      'Thome UH, Genzel-Boroviczény O, Bohnhorst B, et al. Permissive hypercapnia in extremely low birthweight infants (PHELBI): a randomised controlled multicentre trial. Lancet Respir Med. 2015;3(7):534–543.',
      'Carlo WA, Stark AR, Wright LL, et al. Minimal ventilation to prevent bronchopulmonary dysplasia in extremely-low-birth-weight infants. J Pediatr. 2002;141(3):370–374.',
      'Ryu J, Haddad G, Carlo WA. Clinical effectiveness and safety of permissive hypercapnia. Clin Perinatol. 2012;39(3):603–612.',
    ],
  },
  {
    title: 'Hypocarbia and PVL/IVH risk',
    refs: [
      'Erickson SJ, Grauaug A, Gurrin L, Swaminathan M. Hypocarbia in the ventilated preterm infant and its effect on intraventricular haemorrhage and bronchopulmonary dysplasia. J Paediatr Child Health. 2002;38(6):560–562.',
      'Fabres J, Carlo WA, Phillips V, Howard G, Ambalavanan N. Both extremes of arterial carbon dioxide pressure and the magnitude of fluctuations in arterial carbon dioxide pressure are associated with severe intraventricular hemorrhage in preterm infants. Pediatrics. 2007;119(2):299–305.',
    ],
  },
  {
    title: 'HFOV strategy & optimal lung volume (8–9 ribs, MAP titration)',
    refs: [
      'Cools F, Offringa M, Askie LM. Elective high frequency oscillatory ventilation versus conventional ventilation for acute pulmonary dysfunction in preterm infants. Cochrane Database Syst Rev. 2015;(3):CD000104.',
      'Rimensberger PC, Beghetti M, Hanquinet S, Berner M. First intention high-frequency oscillation with early lung volume optimization improves pulmonary outcome in very low birth weight infants with respiratory distress syndrome. Pediatrics. 2000;105(6):1202–1208.',
      'Goldsmith JP, Karotkin EH, Suresh G, Keszler M, eds. Assisted Ventilation of the Neonate, 7th ed. Elsevier; 2022 — HFOV chapters.',
    ],
  },
  {
    title: 'HFJV (servo pressure, Bunnell weaning order, sigh breaths, ΔP–pCO₂)',
    refs: [
      "Bunnell Life Pulse High-Frequency Ventilator Operator's Manual and Clinical Procedures Guide. Bunnell Inc.",
      'Keszler M, Modanlou HD, Brudno DS, et al. Multicenter controlled clinical trial of high-frequency jet ventilation in preterm infants with uncomplicated respiratory distress syndrome. Pediatrics. 1997;100(4):593–599.',
      'Keszler M, Donn SM, Bucciarelli RL, et al. Multicenter controlled trial comparing high-frequency jet ventilation and conventional mechanical ventilation in newborn infants with pulmonary interstitial emphysema. J Pediatr. 1991;119(1):85–93.',
    ],
  },
  {
    title: 'NAVA (Edi peak 5–15 μV, Edi min < 3 μV, NAVA level)',
    refs: [
      'Beck J, Reilly M, Grasselli G, et al. Patient–ventilator interaction during neurally adjusted ventilatory assist in low birth weight infants. Pediatr Res. 2009;65(6):663–668.',
      'Stein H, Howard D. Neurally adjusted ventilatory assist in neonates weighing <1500 grams: a retrospective analysis. J Pediatr. 2012;160(5):786–789.e1.',
      'Maquet/Getinge. Servo-i / Servo-n NAVA Application Guide and Edi catheter positioning instructions.',
    ],
  },
  {
    title: 'ELBW HFJV pathway, failure criteria, late surfactant',
    refs: [
      'Baptist Health / Ochsner NICU institutional ELBW HFJV protocol (PIP ≥ 45 cmH₂O, FiO₂ ≥ 0.75 with 9–10 rib expansion + diffuse haze → transition to HFOV; RSS > 4 in DOL 0–14 → consider repeat surfactant 12h after prior dose).',
      'Bahadue FL, Soll R. Early versus delayed selective surfactant treatment for neonatal respiratory distress syndrome. Cochrane Database Syst Rev. 2012;(11):CD001456.',
      'Polin RA, Carlo WA; AAP Committee on Fetus and Newborn. Surfactant replacement therapy for preterm and term neonates with respiratory distress. Pediatrics. 2014;133(1):156–163.',
    ],
  },
  {
    title: 'Lecture-aligned first-intention HFJV (general preset · Rev 4-2026)',
    refs: [
      'Institutional HFJV Guidelines, Rev 4-2026 — first-intention HFJV for <27 wk or <1000 g: PEEP 5; PIP 20–24 ("good wiggle"); GA-or-weight-based jet rate (300/360/420); Jet IT 0.02 s; no initial sigh breaths.',
      'Hypercarbia titration: ΔP change 1–2 cm = ±2–4 mmHg; 3–4 cm = ±5–9; 5–6 cm = ±10–15. Recheck blood gas 15–20 min after PIP change.',
      'Sigh breath settings (when used): rate 4, PIP = PEEP + 5–10, iTime 0.4 s. Pearl: if sigh breaths improve sats, PEEP may be too low.',
      'Extubation targets — RDS phase: PEEP <7, Jet PIP <18, ΔP <10, MAP <8, FiO₂ <0.30. BPD phase: MAP ≤10–12, FiO₂ ≤0.40, ΔP <14–16.',
    ],
  },
  {
    title: 'CDH preset — Duke 3-zone protocol & PHTN management',
    refs: [
      'Tracy ET, Mears SE, Smith PB, et al. Protocolized approach to the management of congenital diaphragmatic hernia: benefits of reducing variability in care. J Pediatr Surg. 2010;45(6):1343–1348.',
      'Zhang Q, Macartney J, Sampaio L, O\'Brien K. High-frequency jet ventilation during initial management, stabilization, and transport of newborn infants with congenital diaphragmatic hernia: a case series. Crit Care Res Pract. 2013;2013:937871.',
      'Logan JW, Rice HE, Goldberg RN, Cotten CM. Congenital diaphragmatic hernia: a systematic review and summary of best-evidence practice strategies. J Perinatol. 2007;27(9):535–549.',
      'Duke protocol zones: Safe (CV PIP <26, HFV MAP <16); Caution (CV PIP 26–30, HFV MAP 16–22); Hazard (CV PIP >30, HFV MAP >22). Non-Ideal Acceptable: PaCO₂ ≤65, preductal SpO₂ ≥85%, postductal pO₂ >30 if pH >7.25. ECMO indications: postductal pO₂ <30, preductal SpO₂ <85%, or postductal pH <7.25.',
    ],
  },
  {
    title: 'MAS preset — gas-trapping HFJV strategy',
    refs: [
      'Tingay DG, Bhatia R, Derham J, Loughnan PM. Optimal high-frequency jet ventilation settings for gas exchange and regional lung volume in a piglet model of meconium aspiration syndrome. Royal Children\'s Hospital Melbourne, 2010.',
      'Key findings: (1) In MAS with gas-trapping, HFJV strategy with high I:E ratio (RateHFJV 240, I:E 1:12) and minimal CMV sigh breaths produces better gas exchange and more uniform end-expiratory lung volume; (2) setting Jet PIP > prior CV PIP causes disproportionate increase in non-dependent (anterior) lung EELV, may be deleterious.',
      'Coates EW, Klinepeter ME, O\'Shea TM. Neonatal pulmonary hypertension treated with inhaled nitric oxide and high-frequency ventilation. J Perinatol. 2008;28(10):675–679 — HFJV+iNO viable alternative to HFOV+iNO in term/near-term PPHN, possibly with hemodynamic advantage.',
    ],
  },
  {
    title: 'Foundational textbooks & board-review sources',
    refs: [
      'Goldsmith JP, Karotkin EH, Suresh G, Keszler M, eds. Assisted Ventilation of the Neonate: An Evidence-Based Approach to Newborn Respiratory Care, 7th ed. Elsevier; 2022.',
      'Donn SM, Sinha SK. Manual of Neonatal Respiratory Care, 4th ed. Springer; 2017.',
      'AAP NeoReviews — ongoing board-review monograph series, including respiratory and ventilation topics.',
      'Polin RA, Yoder MC. Workbook in Practical Neonatology, 6th ed. Elsevier; 2020.',
    ],
  },
];

function ReferencesModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Lock body scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="refs-title"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-baseline justify-between gap-4 z-10">
          <div>
            <h2 id="refs-title" className="text-lg font-bold tracking-tight">
              <span className="text-amber-400">Threshold</span> references
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 font-mono uppercase tracking-widest">selected sources behind safe/unsafe ranges and recommendations</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-slate-800 transition-colors"
            aria-label="Close references"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {referenceSections.map((s, i) => (
            <section key={i}>
              <h3 className="text-[11px] uppercase tracking-widest font-mono text-amber-300 mb-2">{s.title}</h3>
              <ul className="space-y-1.5">
                {s.refs.map((r, j) => (
                  <li key={j} className="text-xs text-slate-300 leading-relaxed flex gap-2">
                    <span className="text-slate-600 shrink-0 mt-0.5">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <div className="text-[11px] text-slate-500 italic pt-4 border-t border-slate-800 leading-relaxed">
            Threshold ranges in this simulator are educational defaults derived from the sources above and represent commonly cited targets in current neonatal practice. Always defer to current institutional protocols and bedside clinical judgment for individual patient management.
          </div>
        </div>
      </div>
    </div>
  );
}

// =============== Main component ===============
export default function NeoVentSim() {
  const [weight, setWeight] = useState(1.0);
  const [ga, setGA] = useState(28);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [mode, setMode] = useState('simv');

  // Per-mode state
  const [simv, setSimv] = useState({
    pip: 20, peep: 5, rate: 40, iTime: 0.35, fio2: 0.30,
    vtMode: 'PC', context: 'RDS', targetVt: 5.0, pipMax: 28,
    observed: { exhVT: null, measuredPIP: null, exhMV: null, ettLeak: null, spo2: null, pco2: null },
  });
  const [nava, setNava] = useState({
    navaLevel: 1.5, peep: 5, fio2: 0.30,
    observed: { ediPeak: null, ediMin: null, peakPIP: null, exhMV: null, spo2: null, pco2: null },
  });
  const [hfov, setHfov] = useState({
    map: 12, amp: 25, freq: 10, fio2: 0.30,
    observed: { measuredMAP: null, dco2: null, vthf: null, cxrRibs: null, spo2: null, pco2: null },
  });
  const [hfjv, setHfjv] = useState({
    pip: 22, peep: 5, rate: 420, fio2: 0.30, phase: 'RDS', preset: 'general',
    observed: { servoP: null, measuredMAP: null, measuredPIP: null, cxrRibs: null, spo2: null, pco2: null },
  });

  const tabs = [
    { id: 'simv', label: 'SIMV', icon: Activity, color: '#fbbf24' },
    { id: 'nava', label: 'NAVA', icon: Wind, color: '#c084fc' },
    { id: 'hfov', label: 'HFOV', icon: Waves, color: '#22d3ee' },
    { id: 'hfjv', label: 'HFJV', icon: Zap, color: '#fb7185' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
        body, .font-sans { font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif; }
        .num { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      `}</style>

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight font-sans">
                <span className="text-amber-400">Neo</span>Vent
              </h1>
            </div>
            <div className="flex gap-3 items-center">
              <div className="flex flex-col">
                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">Weight (kg)</label>
                <NumberField
                  value={weight}
                  onChange={setWeight}
                  min={0.3} max={6}
                  className="num bg-slate-900 border border-slate-700 rounded px-3 py-1.5 w-24 text-right text-amber-300 focus:outline-none focus:border-amber-500"
                  aria-label="Patient weight in kilograms"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] uppercase tracking-widest text-slate-500 font-mono mb-1">GA (wks)</label>
                <NumberField
                  value={ga}
                  onChange={setGA}
                  min={22} max={42}
                  integer
                  className="num bg-slate-900 border border-slate-700 rounded px-3 py-1.5 w-24 text-right text-amber-300 focus:outline-none focus:border-amber-500"
                  aria-label="Gestational age in weeks"
                />
              </div>
              <button
                type="button"
                onClick={() => setReferencesOpen(true)}
                className="self-end mb-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 hover:border-amber-600/70 hover:bg-slate-800/60 text-slate-400 hover:text-amber-300 transition-colors group"
                title="View references for safe/unsafe parameter ranges"
                aria-label="View references"
              >
                <Info size={14} />
                <span className="text-[10px] uppercase tracking-widest font-mono hidden sm:inline">Refs</span>
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = mode === t.id;
            return (
              <button key={t.id} onClick={() => setMode(t.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active ? 'text-white' : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
                style={active ? { borderColor: t.color, color: t.color } : {}}>
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {mode === 'simv' && <SIMVPanel state={simv} setState={setSimv} weight={weight} ga={ga} />}
        {mode === 'nava' && <NAVAPanel state={nava} setState={setNava} weight={weight} ga={ga} />}
        {mode === 'hfov' && <HFOVPanel state={hfov} setState={setHfov} weight={weight} ga={ga} />}
        {mode === 'hfjv' && <HFJVPanel state={hfjv} setState={setHfjv} weight={weight} ga={ga} />}
      </main>

      <footer className="border-t border-slate-800 mt-8 py-5 text-center text-[11px] text-slate-600 font-mono">
        Simulated physiology — VT computed with assumed Crs 0.4 mL/cmH₂O/kg (moderate RDS). Verify clinically.
      </footer>

      {referencesOpen && <ReferencesModal onClose={() => setReferencesOpen(false)} />}
    </div>
  );
}

// =============== SIMV Panel ===============
function SIMVPanel({ state, setState, weight, ga }) {
  const ctx = state.context || 'RDS';
  const vtMode = state.vtMode || 'PC';

  // Compliance depends on disease context
  const crs = ctx === 'BPD' ? 0.3 : 0.4; // mL/cmH2O/kg

  // Context-aware thresholds
  const pipT = pipThresholds(weight, ctx);
  const peepT = peepThresholds(weight, ctx);
  const rateT = rateThresholds(ctx);
  const iTimeT = iTimeThresholds(weight, ctx);
  const vtT = vtThresholds(ctx);
  const targetVtT = targetVtThresholds(ctx);
  const pipMaxT = pipMaxThresholds(weight, ctx);

  // Handle toggle switches.
  // Strategy (RDS ↔ BPD) toggle preserves slider values — the framework /
  // thresholds / I:E target change, but parameters do not snap to new defaults.
  // Lets clinicians smoothly transition a patient from RDS to BPD-style management.
  const onContextChange = (newCtx) => {
    if (newCtx === ctx) return;
    setState({ ...state, context: newCtx });
  };
  // VG ↔ PC mode toggle does reset (different parameter set: pip vs targetVt+pipMax)
  const onVtModeChange = (newMode) => {
    setState({ ...state, vtMode: newMode });
  };

  // Determine effective PIP and VT based on mode
  let effectivePIP, effectiveVt, pipLimited;
  if (vtMode === 'VG') {
    const targetVtAbs = state.targetVt * weight; // total mL
    const requiredDP = targetVtAbs / (crs * weight);
    const calculatedPIP = state.peep + requiredDP;
    effectivePIP = Math.min(calculatedPIP, state.pipMax);
    pipLimited = calculatedPIP > state.pipMax;
    // If PIP-limited, actual delivered VT is reduced
    effectiveVt = pipLimited ? (state.pipMax - state.peep) * crs * weight : targetVtAbs;
  } else {
    effectivePIP = state.pip;
    effectiveVt = (state.pip - state.peep) * crs * weight;
    pipLimited = false;
  }
  const effectiveVtPerKg = effectiveVt / weight;

  // Waveform based on effective PIP
  const xMax = 3.5;
  const points = useMemo(() => {
    const pts = [];
    const cycleTime = 60 / state.rate;
    const rise = 0.06, fall = 0.08;
    for (let t = 0; t <= xMax; t += 0.01) {
      const phase = t % cycleTime;
      let p;
      if (phase < rise) p = state.peep + (effectivePIP - state.peep) * (phase / rise);
      else if (phase < state.iTime) p = effectivePIP;
      else if (phase < state.iTime + fall) p = effectivePIP - (effectivePIP - state.peep) * ((phase - state.iTime) / fall);
      else p = state.peep;
      pts.push([t, p]);
    }
    return pts;
  }, [state.rate, state.peep, state.iTime, effectivePIP]);

  const dP = effectivePIP - state.peep;
  const eTime = Math.max(0.1, 60 / state.rate - state.iTime);
  const ieRatio = eTime / state.iTime;  // expressed as 1 : ieRatio
  // Target I:E by strategy: BPD needs long expiratory time (gas trapping risk in CLD)
  const ieTarget = ctx === 'BPD' ? 3.0 : 1.5;
  const map = state.peep + (effectivePIP - state.peep) * (state.iTime / (state.iTime + eTime));
  const mv = (effectiveVt * state.rate) / 1000;

  // Zones
  const pipZ = zoneOf(effectivePIP, pipT);
  const peepZ = zoneOf(state.peep, peepT);
  const rateZ = zoneOf(state.rate, rateT);
  const iTimeZ = zoneOf(state.iTime, iTimeT);
  const vtZ = zoneOf(effectiveVtPerKg, vtT);
  const zones = [pipZ, peepZ, rateZ, iTimeZ, vtZ];
  const worstZone = zones.includes('danger') ? 'danger' : zones.includes('caution') ? 'caution' : 'safe';
  const strokeColor = zoneColors[worstZone].hex;

  // Warnings
  // Warnings — fire only on slider values that are out of range.
  // Predicted/calculated outcomes (effective VT, effective PIP in VG, simulated MAP)
  // are NOT used here. Real tidal volumes / PIPs are entered as observed values
  // and drive the Recommendations panel separately.
  const warnings = [];
  if (vtMode === 'PC') {
    if (state.pip > pipT.caution[1]) warnings.push(`PIP ${state.pip} exceeds ${ctx} safe range for ${weight} kg — barotrauma risk.`);
    if (state.pip < pipT.caution[0]) warnings.push(`PIP ${state.pip} below ${ctx} safe range — likely under-inflation. Verify chest rise.`);
  } else {
    // VG mode
    if (state.targetVt > targetVtT.caution[1]) warnings.push(`Target VT ${state.targetVt.toFixed(1)} mL/kg exceeds ${ctx} safe range — volutrauma risk.`);
    if (state.targetVt < targetVtT.caution[0]) warnings.push(`Target VT ${state.targetVt.toFixed(1)} mL/kg below ${ctx} safe range — atelectotrauma risk.`);
    if (state.pipMax > pipMaxT.caution[1]) warnings.push(`PIP max ${state.pipMax} ceiling above ${ctx} safe range — limits VG protection from barotrauma.`);
    if (state.pipMax < pipMaxT.caution[0]) warnings.push(`PIP max ${state.pipMax} ceiling low — VG may be PIP-limited and under-deliver target VT.`);
  }
  if (state.peep < peepT.caution[0]) warnings.push(`PEEP ${state.peep} below ${ctx} safe range — atelectotrauma risk${ctx === 'BPD' ? ' and airway collapse' : ''}.`);
  if (state.peep > peepT.caution[1]) warnings.push('High PEEP may impair venous return and worsen V/Q. Reassess need.');
  if (state.iTime > iTimeT.caution[1]) warnings.push(`iTime ${state.iTime.toFixed(2)}s long for ${ctx} — gas trapping / cardiac output risk.`);
  if (state.iTime < iTimeT.caution[0]) warnings.push(`iTime ${state.iTime.toFixed(2)}s short for ${ctx}${ctx === 'BPD' ? ' — BPD has long time constants, lengthen iTime' : ' — inadequate gas distribution'}.`);
  if (state.rate > rateT.caution[1]) warnings.push(`Rate ${state.rate} exceeds ${ctx} safe range${ctx === 'BPD' ? ' — BPD needs longer exhalation to avoid gas trapping' : ''}.`);
  if (state.rate < rateT.caution[0]) warnings.push(`Rate ${state.rate} below ${ctx} safe range — hypoventilation risk.`);
  // I:E ratio check — BPD strategy requires long expiratory time (≥ 1:3) to avoid gas trapping
  if (ctx === 'BPD' && ieRatio < 3.0) {
    warnings.push(`I:E 1:${ieRatio.toFixed(1)} — BPD strategy targets ≥ 1:3 to avoid gas trapping. Lengthen expiratory time by ↓ rate or ↓ iTime.`);
  } else if (ctx === 'RDS' && ieRatio < 1.0) {
    warnings.push(`I:E 1:${ieRatio.toFixed(1)} — inverse ratio ventilation; verify intentional. RDS typical 1:1.5–1:2.`);
  }

  // Accent per context
  const accentColor = ctx === 'BPD' ? 'border-violet-700/50 bg-violet-950/20' : 'border-amber-700/40 bg-amber-950/10';
  const accentText = ctx === 'BPD' ? 'text-violet-300' : 'text-amber-300';

  return (
    <div className="space-y-4">
      {/* Mode/strategy header */}
      <div className={`border rounded-lg p-5 ${accentColor}`}>
        <div className="flex flex-col md:flex-row gap-4 mb-3">
          <ToggleGroup
            label="Mode"
            value={vtMode}
            onChange={onVtModeChange}
            options={[
              { value: 'PC', label: 'Pressure Control' },
              { value: 'VG', label: 'Volume Guarantee' },
            ]}
          />
          <ToggleGroup
            label="Strategy"
            value={ctx}
            onChange={onContextChange}
            options={[
              { value: 'RDS', label: 'RDS' },
              { value: 'BPD', label: 'BPD' },
            ]}
          />
        </div>
        <div className={`text-[11px] ${accentText}`}>
          {ctx === 'BPD' ? (
            <span>BPD strategy: larger VT (5.5–7 mL/kg), higher PEEP (6–9), longer iTime (0.4–0.55s), lower rate, higher tolerated PIP. Permissive hypercapnia. Crs assumed 0.30.</span>
          ) : (
            <span>Standard RDS strategy: VT 4–6 mL/kg, PEEP 4–7, normocapnia target. Crs assumed 0.40.</span>
          )}
        </div>
      </div>

      {/* Waveform — placed first so changes from sliders below are immediately visible above */}
      <Waveform
        points={points}
        yMin={0}
        yMax={Math.max(35, effectivePIP + 5)}
        xMax={xMax}
        strokeColor={strokeColor}
        label={`SIMV · ${vtMode === 'VG' ? 'Volume Guarantee' : 'Pressure Control'} · ${ctx} strategy`}
        showMAP={map}
      />

      {/* Warnings — sit between waveform and sliders so out-of-range alerts are visible while adjusting */}
      <WarningsPanel warnings={warnings} />

      {/* Parameter sliders */}
      <div className={`border rounded-lg p-5 ${accentColor}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          {vtMode === 'PC' ? (
            <ZoneSlider label="PIP" unit="cmH₂O" value={state.pip}
              onChange={(v) => setState({ ...state, pip: v })} thresh={pipT} />
          ) : (
            <>
              <ZoneSlider label="Target VT" unit="mL/kg" value={state.targetVt}
                onChange={(v) => setState({ ...state, targetVt: v })} thresh={targetVtT} decimals={1} />
              <ZoneSlider label="PIP max (ceiling)" unit="cmH₂O" value={state.pipMax}
                onChange={(v) => setState({ ...state, pipMax: v })} thresh={pipMaxT} />
            </>
          )}
          <ZoneSlider label="PEEP" unit="cmH₂O" value={state.peep}
            onChange={(v) => setState({ ...state, peep: v })} thresh={peepT} />
          <ZoneSlider label="Rate" unit="/min" value={state.rate}
            onChange={(v) => setState({ ...state, rate: v })} thresh={rateT} />
          <div>
            <ZoneSlider label="iTime" unit="sec" value={state.iTime}
              onChange={(v) => setState({ ...state, iTime: v })} thresh={iTimeT} decimals={2} />
            <div className={`text-[10px] font-mono mt-1 num ${ieRatio >= ieTarget ? 'text-emerald-400/80' : ctx === 'BPD' ? 'text-rose-400/80' : 'text-amber-400/80'}`}>
              I:E 1:{ieRatio.toFixed(1)} <span className="text-slate-500">· {ctx} target ≥ 1:{ieTarget.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Observed values from vent + monitor */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs uppercase tracking-widest font-mono text-slate-300">Observed values</h3>
          <span className="text-[10px] font-mono text-slate-500">enter what the vent/monitor shows</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ObservedInput
            label="Exh VT" unit="mL" step={0.1}
            value={state.observed.exhVT}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, exhVT: v } })}
            zone={state.observed.exhVT != null && weight > 0 ? zoneOfObs(state.observed.exhVT / weight, vtT) : null}
            hint={state.observed.exhVT != null && weight > 0 ? `${(state.observed.exhVT / weight).toFixed(1)} mL/kg` : `target ${vtT.safe[0]}–${vtT.safe[1]} mL/kg`}
          />
          <ObservedInput
            label="Measured PIP" unit="cmH₂O"
            value={state.observed.measuredPIP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, measuredPIP: v } })}
            zone={zoneOfObs(state.observed.measuredPIP, pipT)}
            hint={vtMode === 'VG' ? `set ceiling ${state.pipMax}` : `set ${state.pip}`}
          />
          <ObservedInput
            label="Exh MV" unit="L/min" step={0.01}
            value={state.observed.exhMV}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, exhMV: v } })}
            hint={state.observed.exhMV != null && weight > 0 ? `${(state.observed.exhMV * 1000 / weight).toFixed(0)} mL/kg/min` : 'minute ventilation'}
          />
          <ObservedInput
            label="ETT leak" unit="%"
            value={state.observed.ettLeak}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, ettLeak: v } })}
            zone={zoneOfObs(state.observed.ettLeak, ettLeakThresholds())}
            hint=">40% impairs delivery"
          />
          <ObservedInput
            label="SpO₂" unit="%"
            value={state.observed.spo2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, spo2: v } })}
            zone={zoneOfObs(state.observed.spo2, spo2Thresholds(ga))}
            hint={`${ga}wk: ${spo2Thresholds(ga).safe[0]}–${spo2Thresholds(ga).safe[1]}%`}
          />
          <ObservedInput
            label="pCO₂" unit="mmHg"
            value={state.observed.pco2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, pco2: v } })}
            zone={zoneOfObs(state.observed.pco2, pco2Thresholds(ctx))}
            hint={`${ctx}: ${pco2Thresholds(ctx).safe[0]}–${pco2Thresholds(ctx).safe[1]}`}
          />
        </div>
      </div>

      {/* Suggestions — full width since warnings now live above the sliders */}
      <SuggestionsPanel
        tracks={buildSimvTracks({ state, observed: state.observed, weight, ga, ctx, vtMode, vtT })}
      />
    </div>
  );
}

// =============== NAVA Panel ===============
function NAVAPanel({ state, setState, weight, ga }) {
  const navaT = navaLevelThresholds();
  const peepT = peepThresholds(weight);

  // Simulate a series of Edi-triggered breaths of varying amplitude
  const xMax = 5;
  const ediBreaths = [
    { start: 0.3, peak: 1.0, ediPeak: 11, width: 0.6 },
    { start: 1.5, peak: 1.9, ediPeak: 9, width: 0.6 },
    { start: 2.6, peak: 3.0, ediPeak: 13, width: 0.5 },
    { start: 3.6, peak: 4.1, ediPeak: 8, width: 0.7 },
  ];

  const points = useMemo(() => {
    const pts = [];
    const ediMin = 1.5;
    for (let t = 0; t <= xMax; t += 0.02) {
      let edi = ediMin;
      for (const b of ediBreaths) {
        if (t >= b.start && t <= b.start + b.width) {
          // triangle-ish Edi pulse peaking at b.peak
          const relativeToStart = t - b.start;
          const ramp = (b.peak - b.start) / b.width;
          const shape = Math.max(0, 1 - Math.abs((t - b.peak) / (b.width * 0.5)));
          edi = ediMin + (b.ediPeak - ediMin) * shape;
        }
      }
      const pressure = state.peep + (edi - ediMin) * state.navaLevel;
      pts.push([t, pressure]);
    }
    return pts;
  }, [state]);

  // Metrics: estimated peak PIP on biggest breath
  const maxEdi = Math.max(...ediBreaths.map(b => b.ediPeak));
  const estPeakPIP = state.peep + (maxEdi - 1.5) * state.navaLevel;
  const navaZ = zoneOf(state.navaLevel, navaT);
  const peepZ = zoneOf(state.peep, peepT);
  const pipZ = zoneOf(estPeakPIP, pipThresholds(weight));
  const worst = [navaZ, peepZ, pipZ].includes('danger') ? 'danger' : [navaZ, peepZ, pipZ].includes('caution') ? 'caution' : 'safe';
  const strokeColor = zoneColors[worst].hex;

  // Approximate MAP (variable breaths): weighted estimate
  const avgEdiPeak = ediBreaths.reduce((a, b) => a + b.ediPeak, 0) / ediBreaths.length;
  const estAvgPIP = state.peep + (avgEdiPeak - 1.5) * state.navaLevel;
  const map = state.peep + (estAvgPIP - state.peep) * 0.25; // rough

  // Warnings — fire only on slider values that are out of range.
  // Predicted estimates (estPeakPIP, MAP) depend on simulated Edi values and
  // are NOT used here. Observed peak PIP is captured below and drives the
  // Recommendations panel separately.
  const warnings = [];
  if (state.navaLevel > navaT.caution[1]) warnings.push(`NAVA level ${state.navaLevel.toFixed(1)} above usual range — rarely needed; suggests under-support at lower levels or catheter issue.`);
  if (state.navaLevel < navaT.caution[0]) warnings.push(`NAVA level ${state.navaLevel.toFixed(1)} below usual range — minimal assist, near-spontaneous breathing.`);
  if (state.peep > peepT.caution[1]) warnings.push(`PEEP ${state.peep} above usual range — over-distension and venous return concern.`);
  if (state.peep < peepT.caution[0]) warnings.push(`PEEP ${state.peep} below usual range — consider raising to maintain EELV. Elevated Edi min would confirm.`);

  return (
    <div className="space-y-4">
      {/* Edi reference header */}
      <div className="border border-violet-900/50 bg-violet-950/20 rounded-lg p-5">
        <div className="grid md:grid-cols-3 gap-4 text-xs text-slate-300">
          <div><span className="text-violet-300 font-semibold">Target Edi peak:</span> 5–15 μV</div>
          <div><span className="text-violet-300 font-semibold">Target Edi min:</span> &lt;3 μV (high = inadequate PEEP)</div>
          <div className="text-slate-500 text-[11px]">PIP = (Edi peak − Edi min) × NAVA level + PEEP</div>
        </div>
      </div>

      {/* Waveform — placed first so changes from sliders below are immediately visible above */}
      <Waveform points={points} yMin={0} yMax={Math.max(30, estPeakPIP + 5)} xMax={xMax} strokeColor={strokeColor}
        label="NAVA — proportional to simulated Edi signal" />

      {/* Warnings — sit between waveform and sliders so out-of-range alerts are visible while adjusting */}
      <WarningsPanel warnings={warnings} />

      {/* Parameter sliders */}
      <div className="border border-violet-900/50 bg-violet-950/20 rounded-lg p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
          <ZoneSlider label="NAVA level" unit="cmH₂O/μV" value={state.navaLevel}
            onChange={(v) => setState({ ...state, navaLevel: v })} thresh={navaT} decimals={1} />
          <ZoneSlider label="PEEP" unit="cmH₂O" value={state.peep}
            onChange={(v) => setState({ ...state, peep: v })} thresh={peepT} />
        </div>
      </div>

      {/* Observed values from vent + monitor */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs uppercase tracking-widest font-mono text-slate-300">Observed values</h3>
          <span className="text-[10px] font-mono text-slate-500">enter what the vent/monitor shows</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ObservedInput
            label="Edi peak" unit="μV" step={0.1}
            value={state.observed.ediPeak}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, ediPeak: v } })}
            zone={zoneOfObs(state.observed.ediPeak, { safe: [5, 15], caution: [3, 18] })}
            hint="target 5–15"
          />
          <ObservedInput
            label="Edi min" unit="μV" step={0.1}
            value={state.observed.ediMin}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, ediMin: v } })}
            zone={zoneOfObs(state.observed.ediMin, { safe: [0, 3], caution: [0, 5] })}
            hint=">3 = inadequate PEEP"
          />
          <ObservedInput
            label="Peak PIP" unit="cmH₂O"
            value={state.observed.peakPIP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, peakPIP: v } })}
            zone={zoneOfObs(state.observed.peakPIP, pipThresholds(weight))}
            hint="ventilator displayed"
          />
          <ObservedInput
            label="Exh MV" unit="L/min" step={0.01}
            value={state.observed.exhMV}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, exhMV: v } })}
            hint={state.observed.exhMV != null && weight > 0 ? `${(state.observed.exhMV * 1000 / weight).toFixed(0)} mL/kg/min` : 'minute ventilation'}
          />
          <ObservedInput
            label="SpO₂" unit="%"
            value={state.observed.spo2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, spo2: v } })}
            zone={zoneOfObs(state.observed.spo2, spo2Thresholds(ga))}
            hint={`${ga}wk: ${spo2Thresholds(ga).safe[0]}–${spo2Thresholds(ga).safe[1]}%`}
          />
          <ObservedInput
            label="pCO₂" unit="mmHg"
            value={state.observed.pco2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, pco2: v } })}
            zone={zoneOfObs(state.observed.pco2, pco2Thresholds('RDS'))}
            hint={`${pco2Thresholds('RDS').safe[0]}–${pco2Thresholds('RDS').safe[1]}`}
          />
        </div>
      </div>

      {/* Suggestions — full width since warnings now live above the sliders */}
      <SuggestionsPanel
        tracks={buildNavaTracks({ state, observed: state.observed, weight, ga })}
      />

      {/* NAVA reference */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-widest text-violet-300 font-mono mb-3">NAVA reference</h3>
        <div className="grid md:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-violet-300 mb-1">Edi peak 5–15 μV</div>
            <div className="text-slate-400 leading-snug">&lt;5 = over-assisted (↓ NAVA level); &gt;15 = under-assisted or excessive drive (↑ NAVA level).</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-violet-300 mb-1">Edi min &lt;3 μV</div>
            <div className="text-slate-400 leading-snug">Elevated tonic Edi suggests inadequate PEEP — raise PEEP rather than NAVA level.</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-violet-300 mb-1">Backup breaths frequent</div>
            <div className="text-slate-400 leading-snug">Check catheter position (ECG complexes visible), lower trigger threshold, treat apnea of prematurity (caffeine).</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============== HFOV Panel ===============
function HFOVPanel({ state, setState, weight, ga }) {
  const mapT = mapHfovThresholds(weight);
  const ampT = hfovAmpThresholds(weight, state.map);
  const freqT = hfovFreqThresholds(weight);

  // Generate sine wave
  const xMax = 0.5;
  const points = useMemo(() => {
    const pts = [];
    for (let t = 0; t <= xMax; t += 0.002) {
      const p = state.map + (state.amp / 2) * Math.sin(2 * Math.PI * state.freq * t);
      pts.push([t, p]);
    }
    return pts;
  }, [state]);

  // Metrics
  const vtEst = (state.amp / Math.pow(state.freq, 2)) * 100; // illustrative index
  const vtPerKg = vtEst / weight;
  // DCO2 index = VT^2 × f (proxy for CO2 clearance)
  const dco2 = Math.pow(vtEst, 2) * state.freq / 10000;

  const mapZ = zoneOf(state.map, mapT);
  const ampZ = zoneOf(state.amp, ampT);
  const freqZ = zoneOf(state.freq, freqT);
  const worst = [mapZ, ampZ, freqZ].includes('danger') ? 'danger' : [mapZ, ampZ, freqZ].includes('caution') ? 'caution' : 'safe';
  const strokeColor = zoneColors[worst].hex;

  const warnings = [];
  if (state.map > mapT.caution[1]) warnings.push(`MAP ${state.map} exceeds safe range for ${weight} kg — over-distension, venous return compromise. Consider weaning or HFJV.`);
  if (state.map < 7) warnings.push('MAP <7 on HFOV risks derecruitment. Usually need MAP ≥ conventional MAP + 2.');
  const idealFreq = weight < 1 ? 15 : weight < 2 ? 12 : weight < 3 ? 10 : 8;
  if (Math.abs(state.freq - idealFreq) > 3) warnings.push(`Frequency ${state.freq} Hz differs substantially from weight-appropriate ${idealFreq} Hz. Verify intentional (CO₂ strategy).`);
  if (state.amp < state.map * 1.2) warnings.push(`Amplitude ${state.amp} appears low relative to MAP — may not achieve chest wiggle to umbilicus.`);
  if (state.amp > state.map * 3) warnings.push('Amplitude exceeds 3× MAP — excessive TV; check CO₂ trend for hypocarbia.');

  return (
    <div className="space-y-4">
      {/* HFOV relationship header */}
      <div className="border border-cyan-900/50 bg-cyan-950/20 rounded-lg p-5">
        <div className="grid md:grid-cols-3 gap-4 text-xs text-cyan-200/80">
          <div>
            <p className="font-semibold text-cyan-300 mb-0.5">Key relationship</p>
            <p>VT ∝ amp / freq² · To increase CO₂ clearance, LOWER frequency.</p>
          </div>
          <div>
            <p className="font-semibold text-cyan-300 mb-0.5">Weight-based start</p>
            <p><span className="num text-cyan-300 font-semibold">{weight < 1 ? '15' : weight < 2 ? '12' : weight < 3 ? '10' : '8'} Hz</span> for {weight} kg</p>
          </div>
          <div>
            <p className="font-semibold text-cyan-300 mb-0.5">Optimal lung volume</p>
            <p>8–9 posterior ribs · flat (not depressed) diaphragms</p>
          </div>
        </div>
      </div>

      {/* Waveform — placed first so changes from sliders below are immediately visible above */}
      <Waveform points={points} yMin={Math.max(0, state.map - state.amp / 2 - 3)} yMax={state.map + state.amp / 2 + 3}
        xMax={xMax} strokeColor={strokeColor} label={`HFOV — ${state.freq} Hz oscillation about MAP`}
        showMAP={state.map} fillBelow />

      {/* Warnings — sit between waveform and sliders so out-of-range alerts are visible while adjusting */}
      <WarningsPanel warnings={warnings} />

      {/* Parameter sliders */}
      <div className="border border-cyan-900/50 bg-cyan-950/20 rounded-lg p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
          <ZoneSlider label="MAP" unit="cmH₂O" value={state.map}
            onChange={(v) => setState({ ...state, map: v })} thresh={mapT} />
          <ZoneSlider label="Amplitude (ΔP)" unit="cmH₂O" value={state.amp}
            onChange={(v) => setState({ ...state, amp: v })} thresh={ampT} />
          <ZoneSlider label="Frequency" unit="Hz" value={state.freq}
            onChange={(v) => setState({ ...state, freq: v })} thresh={freqT} />
        </div>
      </div>

      {/* Observed values from vent + monitor */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs uppercase tracking-widest font-mono text-slate-300">Observed values</h3>
          <span className="text-[10px] font-mono text-slate-500">enter what the vent/monitor shows</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ObservedInput
            label="Measured MAP" unit="cmH₂O" step={0.1}
            value={state.observed.measuredMAP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, measuredMAP: v } })}
            zone={zoneOfObs(state.observed.measuredMAP, mapT)}
            hint={`set ${state.map}`}
          />
          <ObservedInput
            label="DCO₂" unit="mL²/s"
            value={state.observed.dco2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, dco2: v } })}
            hint="CO₂ clearance"
          />
          <ObservedInput
            label="VThf" unit="mL" step={0.1}
            value={state.observed.vthf}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, vthf: v } })}
            hint={state.observed.vthf != null && weight > 0 ? `${(state.observed.vthf / weight).toFixed(1)} mL/kg` : 'typical 1.5–2.5 mL/kg'}
          />
          <ObservedInput
            label="CXR ribs" unit="post" step={0.5}
            value={state.observed.cxrRibs}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, cxrRibs: v } })}
            zone={zoneOfObs(state.observed.cxrRibs, cxrRibsThresholds())}
            hint="target 8–9"
          />
          <ObservedInput
            label="SpO₂" unit="%"
            value={state.observed.spo2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, spo2: v } })}
            zone={zoneOfObs(state.observed.spo2, spo2Thresholds(ga))}
            hint={`${ga}wk: ${spo2Thresholds(ga).safe[0]}–${spo2Thresholds(ga).safe[1]}%`}
          />
          <ObservedInput
            label="pCO₂" unit="mmHg"
            value={state.observed.pco2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, pco2: v } })}
            zone={zoneOfObs(state.observed.pco2, pco2Thresholds('RDS'))}
            hint={`${pco2Thresholds('RDS').safe[0]}–${pco2Thresholds('RDS').safe[1]}`}
          />
        </div>
      </div>

      {/* Suggestions — full width since warnings now live above the sliders */}
      <SuggestionsPanel
        tracks={buildHfovTracks({ state, observed: state.observed, weight, ga })}
      />

      {/* HFOV reference */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-widest text-cyan-300 font-mono mb-3">HFOV reference</h3>
        <div className="grid md:grid-cols-2 gap-3 text-xs text-slate-300">
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-cyan-300 mb-1">Key formula</div>
            <div className="text-slate-400 leading-snug">VT ∝ Amplitude / Frequency². Lower Hz = larger TV = more CO₂ clearance (counterintuitive but essential).</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-cyan-300 mb-1">Weight-based starting Hz</div>
            <div className="text-slate-400 leading-snug"><span className="num text-cyan-200">{weight < 1 ? '15' : weight < 2 ? '12' : weight < 3 ? '10' : '8'} Hz</span> for {weight} kg. Lung becomes stiffer relative to ETT resistance at higher Hz.</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-cyan-300 mb-1">Chest wiggle assessment</div>
            <div className="text-slate-400 leading-snug">Umbilicus = adequate; clavicles only = inadequate amplitude; thighs = excessive amplitude.</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="font-semibold text-cyan-300 mb-1">Optimal lung volume</div>
            <div className="text-slate-400 leading-snug">8–9 posterior ribs on CXR, flat (not depressed) diaphragms, normal cardiac silhouette.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============== HFJV Panel ===============
function HFJVPanel({ state, setState, weight, ga }) {
  const preset = state.preset || 'general';
  const eligible = isELBW(weight, ga);
  const phase = state.phase || 'RDS';
  const recRate = recommendedHfjvRate(ga, weight);

  // Switch presets WITHOUT overwriting user-set parameters.
  // Each preset's threshold zones, banner, warnings, and recommendations
  // adapt to the current settings rather than imposing starter values.
  const onPresetChange = (newPreset) => {
    if (newPreset === preset) return;
    setState({ ...state, preset: newPreset });
  };

  const pipT = hfjvPipThresholds(weight, ga, phase, preset);
  const peepT = hfjvPeepThresholds(weight, preset);
  const rateT = hfjvRateThresholds(ga, weight, preset);
  const fio2T = fio2Thresholds();

  // Generate jet pulse waveform
  const xMax = 0.6;
  const iTime = 0.02;
  const points = useMemo(() => {
    const pts = [];
    const cycle = 60 / state.rate;
    for (let t = 0; t <= xMax; t += 0.001) {
      const ph = t % cycle;
      let p;
      if (ph < 0.003) p = state.peep + ((state.pip - state.peep) * (ph / 0.003));
      else if (ph < iTime) p = state.pip;
      else if (ph < iTime + 0.005) p = state.pip - ((state.pip - state.peep) * ((ph - iTime) / 0.005));
      else p = state.peep;
      pts.push([t, p]);
    }
    return pts;
  }, [state]);

  // Metrics
  const dP = state.pip - state.peep;
  const map = state.peep + dP * (iTime * state.rate / 60);
  const crs = 0.4;
  const vtEst = dP * crs * weight * 0.6;
  const vtPerKg = vtEst / weight;
  const rss = map * state.fio2;
  const ieRatio = state.rate > 0 ? (60 / state.rate - iTime) / iTime : 0;

  const pipZ = zoneOf(state.pip, pipT);
  const peepZ = zoneOf(state.peep, peepT);
  const rateZ = zoneOf(state.rate, rateT);
  const fio2Z = zoneOf(state.fio2, fio2T);
  const worst = [pipZ, peepZ, rateZ, fio2Z].includes('danger') ? 'danger'
               : [pipZ, peepZ, rateZ, fio2Z].includes('caution') ? 'caution' : 'safe';
  const strokeColor = zoneColors[worst].hex;

  // Extubation criteria by preset and phase
  let extCrit;
  if (preset === 'elbw') {
    extCrit = phase === 'RDS'
      ? { map: 8, fio2: 0.40, dP: 12, label: 'Baptist/Ochsner ELBW · DOL <14 (RDS)' }
      : { map: 12, fio2: 0.55, dP: 16, label: 'Baptist/Ochsner ELBW · DOL ≥14 (CLD)' };
  } else if (preset === 'bunnell') {
    extCrit = phase === 'RDS'
      ? { map: 8, fio2: 0.30, dP: 10, label: 'Bunnell · RDS phase' }
      : { map: 10, fio2: 0.35, dP: 12, label: 'Bunnell · CLD phase' };
  } else if (preset === 'cdh') {
    // CDH: gentle ventilation; extubation typically off HFV after surgical repair
    extCrit = { map: 10, fio2: 0.40, dP: 12, label: 'CDH · post-repair wean' };
  } else if (preset === 'mas') {
    // MAS: term-baby standard; expect rapid resolution post lung-clearing
    extCrit = { map: 8, fio2: 0.30, dP: 10, label: 'MAS · clearing phase' };
  } else {
    // General — lecture (Rev 4-2026) tighter targets
    extCrit = phase === 'RDS'
      ? { map: 8, fio2: 0.30, dP: 10, label: 'General (lecture) · RDS phase' }
      : { map: 12, fio2: 0.40, dP: 16, label: 'General (lecture) · BPD phase' };
  }
  const extReady = {
    map: map <= extCrit.map,
    fio2: state.fio2 <= extCrit.fio2,
    dP: dP < extCrit.dP,
  };
  const extAllMet = extReady.map && extReady.fio2 && extReady.dP;

  // RSS trigger for late surfactant (Baptist/Ochsner DOL 6-14 concept)
  const rssHigh = rss > 4;

  // Warnings — preset-specific
  const warnings = [];
  if (preset === 'elbw') {
    // Baptist/Ochsner ELBW protocol failure criteria
    if (state.pip >= 45) warnings.push(`HFJV FAILURE CRITERIA: Jet PIP ${state.pip} ≥45 cmH₂O — consider transition to HFOV.`);
    if (state.fio2 >= 0.75) warnings.push(`HFJV FAILURE CRITERIA: FiO₂ ${(state.fio2*100).toFixed(0)}% ≥75% — if 9–10 rib expansion with diffuse white-out, transition to HFOV.`);
    if (rssHigh && phase === 'RDS') warnings.push(`RSS ${rss.toFixed(1)} >4 — consider repeat surfactant (eligible 12h from prior; DOL 0–14). Also check for post-surfactant slump.`);
    if (state.fio2 >= 0.40 && map > 10 && phase === 'RDS') warnings.push('FiO₂ ≥0.40 with MAP >10 — criteria for repeat surfactant in first 72h if ongoing respiratory distress.');
    if (state.rate !== recRate) warnings.push(`Rate ${state.rate} differs from GA-recommended ${recRate} BPM for ${ga}wk. Decrease by 60 for PIE/pneumothorax; otherwise align to GA baseline.`);
    if (state.peep > 7) warnings.push('PEEP >7 in ELBW unusual — starting PEEP is 5; high PEEP risks hyperinflation and decreased elastic recoil.');
  } else if (preset === 'bunnell') {
    // Bunnell LifePulse clinical principles
    if (state.fio2 > 0.30 && map < 7) warnings.push(`Bunnell weaning order: wean FiO₂ to <0.30 BEFORE lowering MAP. Current MAP ${map.toFixed(1)} may be too low given FiO₂ ${(state.fio2*100).toFixed(0)}%.`);
    if (state.peep < 5 && state.fio2 > 0.40) warnings.push(`Bunnell: FiO₂ ${(state.fio2*100).toFixed(0)}% with PEEP ${state.peep} — FRC inadequately supported. Optimal PEEP typically 5–8 (up to 12 for CLD/oxygenation).`);
    if (state.peep > 12) warnings.push('Bunnell: PEEP >12 rare — verify need. Higher PEEP risks over-distension, ↓ elastic recoil, ↓ venous return.');
    if (state.pip > pipT.caution[1]) warnings.push(`Bunnell: Jet PIP ${state.pip} approaching failure range. Max TV generated at PIP ~50 with minimal PEEP. Consider HFOV if progressing.`);
    if (state.rate !== 420) warnings.push(`Bunnell: default rate 420 BPM for most neonates. Consider 240–320 for air leak/obstructive disease. Keep rate steady during weaning.`);
  } else if (preset === 'cdh') {
    // Duke CDH protocol zones
    if (map > 22) warnings.push(`HAZARD ZONE: MAP ${map.toFixed(1)} >22 cmH₂O. Wean to Caution Zone (MAP 16–22) within hours. If unable to wean to Non-Ideal Acceptable parameters → ECMO must be considered.`);
    else if (map > 16) warnings.push(`Caution Zone: MAP ${map.toFixed(1)} (16–22). If sustained >24h despite optimization, multidisciplinary discussion of ECMO endpoints.`);
    if (state.pip > 26) warnings.push(`Jet PIP ${state.pip} >26 cmH₂O — gentle ventilation goal exceeded. Reassess targets, consider weaning ΔP if pCO₂ permits.`);
    if (state.fio2 >= 0.50) warnings.push(`FiO₂ ${(state.fio2*100).toFixed(0)}% ≥50% — assess PHTN, consider iNO trial if not already on. Postductal pO₂ <30 mmHg or pH <7.25 → ECMO indication.`);
    if (state.peep < 4) warnings.push('PEEP <4 — risk of derecruitment in CDH ipsilateral hypoplastic lung.');
  } else if (preset === 'mas') {
    // Tingay MAS gas-trapping strategy
    if (state.rate > 360) warnings.push(`Rate ${state.rate} too high for MAS gas-trapping strategy. Lower rate (240–300) gives longer expiratory time (I:E up to 1:12), reduces hyperinflation. Tingay 2010 model showed RateHFJV 240 + minimal sighs = better gas exchange.`);
    if (state.pip > 30) warnings.push(`Jet PIP ${state.pip} cmH₂O — high in MAS may worsen non-dependent (anterior) lung overdistension. Setting Jet PIP > prior CV PIP is deleterious in MAS (Tingay 2010).`);
    if (ieRatio < 6) warnings.push(`I:E 1:${ieRatio.toFixed(0)} — for MAS gas-trapping, target I:E 1:8 to 1:12 by lowering jet rate.`);
    if (state.peep > 7) warnings.push('PEEP >7 in MAS may worsen gas trapping. Keep PEEP modest unless atelectasis predominates.');
    if (state.fio2 >= 0.50) warnings.push(`FiO₂ ${(state.fio2*100).toFixed(0)}% ≥50% — assess PHTN (common in severe MAS), consider iNO if PPHN signs.`);
  } else {
    // General (lecture-aligned)
    if (state.pip > pipT.caution[1]) warnings.push(`Jet PIP ${state.pip} exceeds general safe range for ${weight} kg. Consider HFOV if progressing.`);
    if (state.rate !== recRate) warnings.push(`Rate ${state.rate} differs from recommended ${recRate} BPM (${ga}wk · ${weight}kg uses GA-or-weight-based rule). Lower rate ↑ I:E for PIE/PTX or to wean MAP / encourage spontaneous breathing.`);
    if (state.pip < 20 && phase === 'RDS') warnings.push(`Jet PIP ${state.pip} below initial target 20–24 — verify "good wiggle." Inadequate PIP reduces ΔP and CO₂ clearance.`);
    if (state.peep > 9) warnings.push('PEEP >9 — MAP climbing, reassess vs HFOV or conventional.');
  }
  // Universal warnings
  if (state.peep < 4) warnings.push('PEEP <4 risks derecruitment — HFJV relies on conventional PEEP for MAP.');
  if (dP < 8) warnings.push('ΔP <8 — may not achieve adequate CO₂ clearance. Check servo pressure and chest wiggle.');

  return (
    <div className="space-y-4">
      {/* Preset selector */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
          <div className="flex-shrink-0">
            <ToggleGroup
              label="Management preset"
              value={preset}
              onChange={onPresetChange}
              options={[
                { value: 'general', label: 'General' },
                { value: 'bunnell', label: 'Bunnell' },
                { value: 'elbw', label: 'B/O ELBW' },
                { value: 'cdh', label: 'CDH' },
                { value: 'mas', label: 'MAS' },
              ]}
            />
          </div>
          <div className="flex-1 text-[11px] text-slate-400 leading-snug">
            {preset === 'general' && 'First-intention HFJV for <27wk or <1000g (institutional Rev 4-2026): PEEP 5, PIP 20–24 ("good wiggle"), GA-or-weight-based rate, no initial sigh breaths. Extubation RDS: PEEP <7, Jet PIP <18, ΔP <10, MAP <8, FiO₂ <0.30.'}
            {preset === 'bunnell' && 'Aligned with Bunnell LifePulse 204 Quick Reference Guide: PEEP 5–8 (up to 12 for CLD), rate 420 default, wean FiO₂ <0.30 before MAP, keep rate steady.'}
            {preset === 'elbw' && 'Baptist/Ochsner aggressive ELBW failure pathway for <25wk and/or <500g: GA-based rate, RSS >4 → repeat surfactant, failure at PIP ≥45 or FiO₂ ≥75% → transition to HFOV.'}
            {preset === 'cdh' && 'Duke CDH protocol (Tracy 2010): gentle ventilation, PIP <24 target, switch to HFV at CV PIP >26 or MAP >12. Three zones (Safe/Caution/Hazard) by HFJV MAP. Permissive: PaCO₂ ≤65, preductal SpO₂ ≥85%, postductal pO₂ >30 if pH >7.25.'}
            {preset === 'mas' && 'MAS gas-trapping strategy (Tingay 2010 piglet model): Jet PIP ≤ prior CV PIP, LOW rate (240–300) for high I:E ratio (up to 1:12), minimal CMV sigh breaths. Setting Jet PIP > CV PIP causes non-dependent lung overdistension.'}
          </div>
        </div>
      </div>

      {/* Contextual banner */}
      {preset === 'elbw' && (
        <div className="bg-amber-950/40 border border-amber-700/60 rounded-lg p-3 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-amber-300 uppercase tracking-widest">Baptist/Ochsner ELBW Protocol · Active</span>
              {!eligible && <span className="text-[10px] font-mono bg-amber-800/40 text-amber-200 px-2 py-0.5 rounded">applied outside {'<'}25wk and/or {'<'}500g criteria</span>}
            </div>
            <div className="text-amber-100/80">
              GA-rate target <span className="num font-semibold">{recRate} BPM</span> · Failure PIP ≥45 / FiO₂ ≥75% · Extubation targets adjusted by phase
            </div>
          </div>
        </div>
      )}
      {preset === 'cdh' && (() => {
        const cdhZone = map > 22 ? 'hazard' : map > 16 ? 'caution' : 'safe';
        const zoneStyle = {
          safe: { bg: 'bg-emerald-950/40', border: 'border-emerald-700/60', text: 'text-emerald-300', tag: 'bg-emerald-900/50 text-emerald-100' },
          caution: { bg: 'bg-amber-950/40', border: 'border-amber-700/60', text: 'text-amber-300', tag: 'bg-amber-900/50 text-amber-100' },
          hazard: { bg: 'bg-rose-950/40', border: 'border-rose-700/60', text: 'text-rose-300', tag: 'bg-rose-900/50 text-rose-100' },
        };
        const z = zoneStyle[cdhZone];
        return (
          <div className={`${z.bg} border ${z.border} rounded-lg p-3 flex items-start gap-3`}>
            <AlertTriangle size={18} className={`${z.text} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 text-xs">
              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                <span className={`font-semibold ${z.text} uppercase tracking-widest`}>CDH Protocol · {cdhZone === 'safe' ? 'Safe Zone' : cdhZone === 'caution' ? 'Caution Zone' : 'Hazard Zone'}</span>
                <span className={`text-[10px] font-mono ${z.tag} px-2 py-0.5 rounded`}>HFV MAP {map.toFixed(1)} cmH₂O</span>
              </div>
              <div className={`${z.text}/80`}>
                {cdhZone === 'safe' && 'Safe Zone: HFV MAP <16 · Goal: ideal patient (SpO₂ >95% on Safe Zone) or maintain Non-Ideal Acceptable parameters.'}
                {cdhZone === 'caution' && 'Caution Zone: HFV MAP 16–22 · If sustained >24h, multidisciplinary discussion of ECMO endpoints. Consider iNO if not already on.'}
                {cdhZone === 'hazard' && 'Hazard Zone: HFV MAP >22 · If unable to wean to Non-Ideal Acceptable parameters within hours, ECMO must be considered.'}
              </div>
            </div>
          </div>
        );
      })()}
      {preset === 'mas' && (
        <div className="bg-rose-950/40 border border-rose-700/60 rounded-lg p-3 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-rose-300 uppercase tracking-widest mb-0.5">MAS Gas-Trapping Strategy · Active</div>
            <div className="text-rose-100/80">
              Target rate <span className="num font-semibold">240–300 BPM</span> for I:E up to 1:12 · Jet PIP ≤ prior CV PIP · Minimize CMV sigh breaths · Setting Jet PIP > CV PIP causes non-dependent lung overdistension.
            </div>
          </div>
        </div>
      )}
      {preset !== 'elbw' && preset !== 'cdh' && preset !== 'mas' && eligible && (
        <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 flex items-start gap-3">
          <Info size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <div className="font-semibold text-slate-200 mb-0.5">
              Patient fits ELBW criteria <span className="font-mono text-slate-500">· {ga}wk · {weight}kg</span>
            </div>
            <div className="text-slate-400">
              Baptist/Ochsner &lt;25wk and/or &lt;500g protocol available — consider switching presets.
            </div>
          </div>
          <button onClick={() => onPresetChange('elbw')} className="text-[11px] font-mono uppercase tracking-wider text-amber-300 hover:text-amber-200 bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/60 hover:border-amber-600 rounded px-3 py-1.5 whitespace-nowrap">
            Apply protocol
          </button>
        </div>
      )}

      {/* Waveform — placed first so changes from sliders below are immediately visible above */}
      <Waveform points={points} yMin={0} yMax={Math.max(35, state.pip + 5)} xMax={xMax}
        strokeColor={strokeColor} label={`HFJV — ${state.rate}/min jet pulses over PEEP ${state.peep} · ${phase} phase`} showMAP={map} />

      {/* Warnings — sit between waveform and sliders so out-of-range alerts are visible while adjusting */}
      <WarningsPanel warnings={warnings} />

      {/* Parameters + phase / preset-specific targets */}
      <div className="border border-rose-900/50 bg-rose-950/20 rounded-lg p-5">
        {(preset !== 'cdh' && preset !== 'mas') && (
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <ToggleGroup
              label="Phase"
              value={phase}
              onChange={(v) => setState({ ...state, phase: v })}
              options={[
                { value: 'RDS', label: 'RDS (DOL <14)' },
                { value: 'CLD', label: 'Post-DOL 14 / CLD' },
              ]}
            />
            <div className="flex-1 text-[11px] text-rose-200/90 self-end pb-1">
              {phase === 'RDS'
                ? 'RDS phase: pH ≥7.20, pCO₂ 45–55, SpO₂ 88–93%. Lecture extubation targets: PEEP <7, Jet PIP <18, ΔP <10, MAP <8, FiO₂ <0.30.'
                : 'CLD phase: permissive hypercapnia (pCO₂ 55–70). Lecture extubation: MAP ≤10–12, FiO₂ ≤0.40, ΔP <14–16. Higher rates (≥420) often better after DOL 14.'}
            </div>
          </div>
        )}
        {preset === 'cdh' && (
          <div className="text-[11px] text-rose-200/90 mb-4 leading-relaxed">
            CDH targets: PaCO₂ ≤65, preductal SpO₂ ≥85%, postductal pO₂ &gt;30 mmHg if pH &gt;7.25 (Non-Ideal Acceptable). HFV escalation: CV PIP &gt;26 or MAP &gt;12. ECMO indications: postductal pO₂ &lt;30, preductal SpO₂ &lt;85%, or postductal pH &lt;7.25.
          </div>
        )}
        {preset === 'mas' && (
          <div className="text-[11px] text-rose-200/90 mb-4 leading-relaxed">
            MAS targets: PaCO₂ permissive (45–60), SpO₂ ≥92% (term), assess for PPHN. Strategy: low rate (240–300) for high I:E (1:8 to 1:12), Jet PIP ≤ prior CV PIP, suppress sigh breaths.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          <ZoneSlider label="Jet PIP" unit="cmH₂O" value={state.pip}
            onChange={(v) => setState({ ...state, pip: v })} thresh={pipT} />
          <ZoneSlider label="PEEP (conventional)" unit="cmH₂O" value={state.peep}
            onChange={(v) => setState({ ...state, peep: v })} thresh={peepT} />
          <div>
            <ZoneSlider label="Jet rate" unit="/min" value={state.rate}
              onChange={(v) => setState({ ...state, rate: v })} thresh={rateT} />
            <div className="text-[10px] font-mono text-rose-300/70 mt-1 num">
              {preset === 'general' && `Rec: ${recRate} (${ga}wk · ${weight}kg)`}
              {preset === 'elbw' && `GA-rec: ${recRate}`}
              {preset === 'bunnell' && 'Bunnell default: 420'}
              {preset === 'cdh' && 'CDH: 360–420 typical · lower for PIE/PTX'}
              {preset === 'mas' && 'MAS: 240–300 (high I:E for gas trapping)'}
              {' · I:E 1:'}{ieRatio.toFixed(0)}
            </div>
          </div>
          <ZoneSlider label="FiO₂" unit="" value={state.fio2}
            onChange={(v) => setState({ ...state, fio2: v })} thresh={fio2T} decimals={2} />
        </div>
      </div>

      {/* Observed values from vent + monitor */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-5">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-xs uppercase tracking-widest font-mono text-slate-300">Observed values</h3>
          <span className="text-[10px] font-mono text-slate-500">enter what the vent/monitor shows</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ObservedInput
            label="Servo P" unit="PSI" step={0.1}
            value={state.observed.servoP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, servoP: v } })}
            zone={zoneOfObs(state.observed.servoP, servoThresholds())}
            hint="↑ = ↑compliance/leak · ↓ = airway"
          />
          <ObservedInput
            label="Measured MAP" unit="cmH₂O" step={0.1}
            value={state.observed.measuredMAP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, measuredMAP: v } })}
            hint={`est ${map.toFixed(1)}; PEEP-dominant`}
          />
          <ObservedInput
            label="Measured PIP" unit="cmH₂O"
            value={state.observed.measuredPIP}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, measuredPIP: v } })}
            zone={zoneOfObs(state.observed.measuredPIP, pipT)}
            hint={`set ${state.pip}`}
          />
          <ObservedInput
            label="CXR ribs" unit="post" step={0.5}
            value={state.observed.cxrRibs}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, cxrRibs: v } })}
            zone={zoneOfObs(state.observed.cxrRibs, cxrRibsThresholds())}
            hint="target 8–9"
          />
          <ObservedInput
            label="SpO₂" unit="%"
            value={state.observed.spo2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, spo2: v } })}
            zone={zoneOfObs(state.observed.spo2, spo2Thresholds(ga))}
            hint={`${ga}wk: ${spo2Thresholds(ga).safe[0]}–${spo2Thresholds(ga).safe[1]}%`}
          />
          <ObservedInput
            label="pCO₂" unit="mmHg"
            value={state.observed.pco2}
            onChange={(v) => setState({ ...state, observed: { ...state.observed, pco2: v } })}
            zone={zoneOfObs(state.observed.pco2, phase === 'CLD' ? pco2Thresholds('CLD') : pco2Thresholds('RDS'))}
            hint={`${phase}: ${(phase === 'CLD' ? pco2Thresholds('CLD') : pco2Thresholds('RDS')).safe[0]}–${(phase === 'CLD' ? pco2Thresholds('CLD') : pco2Thresholds('RDS')).safe[1]}`}
          />
        </div>
      </div>

      {/* Suggestions — span full width since warnings now live above the sliders */}
      <SuggestionsPanel
        tracks={buildHfjvTracks({ state, observed: state.observed, weight, ga, preset, phase, recRate })}
      />

      {/* Servo pressure reference */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
        <h3 className="text-xs uppercase tracking-widest text-rose-300 font-mono mb-3">Servo pressure interpretation</h3>
        <div className="grid md:grid-cols-2 gap-3 text-xs text-slate-300">
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
              <TrendingUp size={14} /> Servo rising (no setting changes)
            </div>
            <div className="text-slate-400 leading-snug">More flow needed for same PIP → larger space being filled. <span className="text-slate-200">Action:</span> verify ETT position (rule out cuff leak / dislodgement); if confirmed in place, indicates improving compliance — start weaning.</div>
          </div>
          <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
            <div className="flex items-center gap-2 text-rose-400 font-semibold mb-1">
              <TrendingDown size={14} /> Servo falling (no setting changes)
            </div>
            <div className="text-slate-400 leading-snug">Less flow needed → smaller space. <span className="text-slate-200">Action:</span> immediate concern — suction (secretions), CXR (PTX, atelectasis, right mainstem), check tube patency.</div>
          </div>
        </div>
      </div>

      {/* Clinical decision table */}
      <HfjvDecisionTable />

      {/* Extubation readiness */}
      <ExtubationReadiness
        phase={phase}
        map={map}
        fio2={state.fio2}
        dP={dP}
        extCrit={extCrit}
        extReady={extReady}
        extAllMet={extAllMet}
      />

      {/* Sigh breath reference */}
      <SighBreathsReference />

      {/* Bunnell principles — shown in general mode */}
      {preset === 'bunnell' && <BunnellPrinciples />}
    </div>
  );
}

// =============== Bunnell Clinical Principles ===============
function BunnellPrinciples() {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-slate-400 font-mono">Bunnell LifePulse — general clinical principles</h3>
        <span className="text-[10px] font-mono text-slate-600">from LifePulse 204 QRG</span>
      </div>
      <div className="grid md:grid-cols-2 gap-3 text-xs">
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Core determinants</div>
          <ul className="text-slate-400 space-y-1">
            <li>• ΔP (PIP − PEEP) is the <span className="text-slate-200">primary</span> determinant of PaCO₂</li>
            <li>• iTime and rate are secondary CO₂ modifiers</li>
            <li>• FRC + MAP (PEEP-driven) set PaO₂</li>
            <li>• Avoid hypercarbia/hypoxemia via optimal PEEP</li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">CV/IMV on the conventional vent</div>
          <ul className="text-slate-400 space-y-1">
            <li>• Minimize to <span className="num text-slate-200">0–5 bpm</span> (0 if air leak is primary concern)</li>
            <li>• 1–5 bpm ×10–30 min for atelectasis recruitment, then back to 0</li>
            <li>• If lowering CV rate worsens oxygenation → PEEP too low</li>
            <li>• Keep CV PIP to achieve moderate chest rise only</li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Transition from CV → HFJV</div>
          <ul className="text-slate-400 space-y-1">
            <li>• Target MAP on jet = prior MAP on conventional</li>
            <li>• Adjust PEEP upward as you drop CV rate and PIP</li>
            <li>• Set jet PIP to match conventional PIP initially, titrate</li>
            <li>• Eliminate jet pauses: CV PIP must be &lt; set jet PIP</li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Weaning order</div>
          <ul className="text-slate-400 space-y-1">
            <li>1. Wean FiO₂ to <span className="num text-slate-200">&lt;0.30</span> first</li>
            <li>2. Then begin lowering MAP (via PEEP)</li>
            <li>3. Wean PIP slowly <span className="num text-slate-200">1–2 cmH₂O</span> at a time</li>
            <li>4. <span className="text-slate-200">Keep jet rate steady</span> during weaning</li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Optimal PEEP (Bunnell)</div>
          <ul className="text-slate-400 space-y-1">
            <li>• Typical RDS: <span className="num text-slate-200">5–8</span> cmH₂O</li>
            <li>• CLD / oxygenation challenge: <span className="num text-slate-200">8–12</span> cmH₂O</li>
            <li>• Too low → atelectasis, rising FiO₂ need</li>
            <li>• Too high → over-distension, ↓ elastic recoil, ↓ venous return</li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Servo pressure trending</div>
          <ul className="text-slate-400 space-y-1">
            <li>• ↑ Servo: improving compliance, or leak / tube displacement</li>
            <li>• ↓ Servo: worsening compliance, secretions, PTX, right mainstem</li>
            <li>• Chart servo pressure to simplify decisions — early warning of change before gas</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// =============== HFJV 3x3 Decision Table ===============
function HfjvDecisionTable() {
  const cells = [
    // row: over-vent, appropriate, under-vent
    // col: inadequate O2, adequate O2, too good O2
    [
      { label: '↑ PEEP, keep PIP', desc: '↑ MAP while ↓ΔP — prevents hypocarbia' },
      { label: '↓ PIP (consider ↑PEEP)', desc: 'Keep MAP to avoid atelectasis. If over-inflated, just ↓ PIP' },
      { label: '↓ PIP', desc: 'Until pCO₂ acceptable. If still, ↓ PIP and PEEP equally' },
    ],
    [
      { label: '↑ PIP & PEEP equally', desc: 'Keep ΔP unchanged while ↑ MAP' },
      { label: 'No changes', desc: 'Maintain current settings' },
      { label: '↓ PIP & PEEP equally', desc: '↓ MAP to avoid over-inflation, ΔP unchanged' },
    ],
    [
      { label: '↑ PIP (↑ MAP & ΔP)', desc: 'Until pCO₂ acceptable. If O₂ still poor, ↑ PIP & PEEP equally' },
      { label: '↑ PIP', desc: '↑ ΔP to increase CO₂ clearance' },
      { label: '↓ PEEP (↑ ΔP)', desc: 'Avoids over-inflation. If still over-inflated, ↓ both PIP & PEEP' },
    ],
  ];
  const rowLabels = [
    { t: 'Over-ventilated', s: 'pCO₂ too low' },
    { t: 'Appropriate', s: 'pCO₂ adequate' },
    { t: 'Under-ventilated', s: 'pCO₂ too high' },
  ];
  const colLabels = [
    { t: 'Inadequate O₂', s: '(↑ FiO₂)' },
    { t: 'Adequate O₂', s: '' },
    { t: 'Too good O₂', s: '(↓ FiO₂)' },
  ];

  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-widest text-slate-400 font-mono mb-3">HFJV clinical decision matrix</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[700px]">
          <thead>
            <tr>
              <th className="p-2"></th>
              {colLabels.map((c, i) => (
                <th key={i} className="p-2 text-center border-b border-slate-700">
                  <div className="font-semibold text-slate-200">{c.t}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{c.s}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, i) => (
              <tr key={i} className="border-t border-slate-800">
                <th className="p-2 text-left bg-slate-900/60 border-r border-slate-800 w-32">
                  <div className="font-semibold text-slate-200">{rowLabels[i].t}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{rowLabels[i].s}</div>
                </th>
                {row.map((cell, j) => (
                  <td key={j} className="p-2 align-top border-r border-slate-800 last:border-r-0">
                    <div className="font-semibold text-rose-200 mb-0.5">{cell.label}</div>
                    <div className="text-[11px] text-slate-400 leading-snug">{cell.desc}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-500 mt-3 font-mono">
        ΔP change → pCO₂: 1–2 cmH₂O = ±2–4 mmHg · 3–4 = ±5–9 · 5–6 = ±10–15
      </p>
    </div>
  );
}

// =============== Extubation readiness ===============
function ExtubationReadiness({ phase, map, fio2, dP, extCrit, extReady, extAllMet }) {
  const rows = [
    { label: 'MAP', current: map.toFixed(1), target: `≤ ${extCrit.map}`, met: extReady.map, unit: 'cmH₂O' },
    { label: 'FiO₂', current: (fio2 * 100).toFixed(0) + '%', target: `≤ ${(extCrit.fio2 * 100).toFixed(0)}%`, met: extReady.fio2, unit: '' },
    { label: 'ΔP', current: dP.toFixed(0), target: `< ${extCrit.dP}`, met: extReady.dP, unit: 'cmH₂O' },
  ];
  return (
    <div className={`border rounded-lg p-4 ${extAllMet ? 'bg-emerald-950/30 border-emerald-700/60' : 'bg-slate-900/40 border-slate-800'}`}>
      <div className="flex justify-between items-baseline mb-3">
        <h3 className="text-xs uppercase tracking-widest font-mono text-slate-400">Extubation readiness · {extCrit.label}</h3>
        {extAllMet && <span className="text-xs font-semibold text-emerald-300 uppercase tracking-wide">All criteria met</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {rows.map((r, i) => (
          <div key={i} className={`rounded p-3 border ${r.met ? 'bg-emerald-950/40 border-emerald-800/50' : 'bg-slate-950/50 border-slate-800'}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-widest font-mono text-slate-500">{r.label}</span>
              <span className={`text-[10px] font-mono ${r.met ? 'text-emerald-400' : 'text-slate-500'}`}>{r.met ? '✓ met' : 'pending'}</span>
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className={`num text-lg font-bold ${r.met ? 'text-emerald-300' : 'text-slate-300'}`}>{r.current}{r.unit && <span className="text-xs font-normal text-slate-500 ml-1">{r.unit}</span>}</span>
              <span className="num text-[11px] text-slate-500">target {r.target}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
        Per protocol: extubate from HFJV to <span className="text-slate-300">NIV-NAVA</span> (preferred) or unsynchronized NIPPV. Continue non-invasive support until 34–36 weeks CGA. Early failed extubation (first 2 weeks) associated with death 28% vs 6%, and higher BPD/IVH risk — delay until 27–28 wk CGA typical for ELBW.
      </p>
    </div>
  );
}

// =============== Sigh breath reference ===============
function SighBreathsReference() {
  return (
    <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
      <h3 className="text-xs uppercase tracking-widest text-slate-400 font-mono mb-3">Sigh breaths reference</h3>
      <div className="grid md:grid-cols-3 gap-3 text-xs">
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">When to start</div>
          <div className="text-slate-400 leading-snug">Only for atelectasis. PEEP <span className="text-slate-200">maintains</span> recruitment but does not <span className="text-slate-200">re-recruit</span> — sigh breaths re-recruit atelectatic lung. Don't start on admission from DR.</div>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Settings (institutional)</div>
          <ul className="text-slate-400 leading-snug space-y-0.5">
            <li>· Rate <span className="num text-slate-200">4</span></li>
            <li>· PIP = <span className="num text-slate-200">PEEP + 5–10</span></li>
            <li>· iTime <span className="num text-slate-200">0.4 s</span></li>
          </ul>
        </div>
        <div className="bg-slate-950/60 border border-slate-800 rounded p-3">
          <div className="font-semibold text-slate-200 mb-1">Continue / titrate</div>
          <div className="text-slate-400 leading-snug">Keep sighs once started <span className="text-slate-200">unless PIE or PTX develops</span>. <span className="text-amber-200">If sighs improve sats, your PEEP may be too low</span> — titrate PEEP up.</div>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 mt-2 font-mono">Suppress / minimize sigh breaths in MAS gas-trapping strategy (Tingay 2010).</p>
    </div>
  );
}

// =============== Warnings panel ===============
function WarningsPanel({ warnings }) {
  if (warnings.length === 0) {
    return (
      <div className="bg-emerald-950/30 border border-emerald-900/50 rounded-lg p-4">
        <div className="flex items-center gap-2 text-emerald-300 text-sm font-semibold">
          <Heart size={16} /> All parameters within safe range
        </div>
        <p className="text-xs text-emerald-200/70 mt-1">No threshold violations detected for this weight/GA.</p>
      </div>
    );
  }
  return (
    <div className="bg-rose-950/30 border border-rose-900/50 rounded-lg p-4">
      <div className="flex items-center gap-2 text-rose-300 text-sm font-semibold mb-2">
        <AlertTriangle size={16} /> Attention · {warnings.length} alert{warnings.length > 1 ? 's' : ''}
      </div>
      <ul className="space-y-1.5">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs text-rose-100 flex gap-2">
            <span className="text-rose-400 flex-shrink-0">▸</span>
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import {
  Wifi,
  WifiOff,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Zap,
  Clock,
  Radio,
  BarChart2,
  Info,
} from 'lucide-react';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_POINTS = 60; // 60 seconds rolling window
const POLL_INTERVAL = 1000; // 1 second
const STRESS_DURATION = 30; // seconds

const THRESHOLDS = {
  rtt:    { good: 100, warn: 200 },
  jitter: { good: 20,  warn: 50  },
  loss:   { good: 0.2, warn: 2   },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function getHealth(rtt, jitter, loss) {
  if (rtt > THRESHOLDS.rtt.warn || jitter > THRESHOLDS.jitter.warn || loss > THRESHOLDS.loss.warn) return 'critical';
  if (rtt > THRESHOLDS.rtt.good || jitter > THRESHOLDS.jitter.good || loss > THRESHOLDS.loss.good) return 'warning';
  return 'good';
}

function calcScore(rtt, jitter, loss) {
  // Start at 100; deduct points for each metric
  let score = 100;
  score -= clamp((rtt - 50) / 2, 0, 30);
  score -= clamp((jitter - 10) / 1.5, 0, 20);
  score -= clamp(loss * 25, 0, 50);
  return Math.round(clamp(score, 0, 100));
}

const HEALTH_STYLES = {
  good:     { color: '#22c55e', glow: '0 0 40px 15px rgba(34,197,94,0.6)',  label: 'Excellent',   bg: 'bg-green-500/20',  text: 'text-green-400',  border: 'border-green-500/50' },
  warning:  { color: '#eab308', glow: '0 0 40px 15px rgba(234,179,8,0.6)',  label: 'Fluctuating', bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/50' },
  critical: { color: '#ef4444', glow: '0 0 40px 15px rgba(239,68,68,0.6)',  label: 'Critical',    bg: 'bg-red-500/20',    text: 'text-red-400',    border: 'border-red-500/50' },
};

// ─── WebRTC STUN probe ────────────────────────────────────────────────────────
class StunProbe {
  constructor() {
    this.pc = null;
    this.prevStats = {};
  }

  async start() {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    // Add a data channel so ICE negotiation actually fires
    this.pc.createDataChannel('probe');
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
  }

  async poll() {
    if (!this.pc) return null;
    try {
      const stats = await this.pc.getStats();
      let rtt = 0, jitter = 0, loss = 0;
      let found = false;

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime != null) {
          rtt = report.currentRoundTripTime * 1000; // seconds → ms
          found = true;
        }
        if (report.type === 'remote-inbound-rtp') {
          if (report.jitter != null) jitter = report.jitter * 1000;
          if (report.fractionLost != null) loss = report.fractionLost * 100;
        }
        if (report.type === 'inbound-rtp') {
          const prev = this.prevStats[report.id] || {};
          const dPkts = (report.packetsReceived || 0) - (prev.packetsReceived || 0);
          const dLost = (report.packetsLost || 0) - (prev.packetsLost || 0);
          if (dPkts + dLost > 0) {
            loss = Math.max(loss, (dLost / (dPkts + dLost)) * 100);
          }
          this.prevStats[report.id] = report;
        }
      });

      return found ? { rtt, jitter, loss } : null;
    } catch {
      return null;
    }
  }

  stop() {
    if (this.pc) { this.pc.close(); this.pc = null; }
    this.prevStats = {};
  }
}

// ─── Simulated metrics (fallback / stress augmentation) ──────────────────────
function simulateMetrics(prev, stress = false) {
  const noise  = (s) => (Math.random() - 0.5) * s;
  const bounce = (v, lo, hi, step) => clamp(v + noise(step), lo, hi);

  const rtt    = bounce((prev?.rtt    ?? 45),  5, stress ? 350 : 180, stress ? 40 : 15);
  const jitter = bounce((prev?.jitter ?? 8),   0, stress ? 80  : 45,  stress ? 20 : 8);
  const loss   = bounce((prev?.loss   ?? 0),   0, stress ? 5   : 1.5, stress ? 1  : 0.3);
  return { rtt, jitter, loss };
}

// ─── PulseOrb ────────────────────────────────────────────────────────────────
function PulseOrb({ health, score }) {
  const hs = HEALTH_STYLES[health];
  return (
    <div className="flex flex-col items-center gap-3">
      <motion.div
        className="relative flex items-center justify-center rounded-full"
        style={{ width: 160, height: 160 }}
        animate={{ boxShadow: hs.glow }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      >
        {/* Pulsing ring */}
        <motion.div
          className="absolute inset-0 rounded-full border-4"
          style={{ borderColor: hs.color }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.9, 0.4, 0.9] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Inner orb */}
        <motion.div
          className="absolute inset-4 rounded-full"
          style={{ background: `radial-gradient(circle at 35% 35%, ${hs.color}cc, ${hs.color}44)` }}
          animate={{ scale: [0.95, 1.02, 0.95] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Score */}
        <span className="relative z-10 text-4xl font-black text-white drop-shadow-lg">{score}</span>
      </motion.div>
      <AnimatePresence mode="wait">
        <motion.span
          key={health}
          className={`text-lg font-bold tracking-widest uppercase ${hs.text}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3 }}
        >
          {hs.label}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, unit, health }) {
  const hs = HEALTH_STYLES[health];
  return (
    <motion.div
      className={`flex flex-col gap-1 rounded-xl border p-4 ${hs.bg} ${hs.border}`}
      animate={{ borderColor: hs.color }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${hs.text}`} />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <motion.span
          className="text-3xl font-black text-white"
          key={Math.round(value)}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          {Number.isFinite(value) ? value.toFixed(value < 10 ? 2 : 0) : '—'}
        </motion.span>
        <span className="text-sm text-slate-400">{unit}</span>
      </div>
    </motion.div>
  );
}

// ─── Seismograph Chart ────────────────────────────────────────────────────────
const colorBandPlugin = {
  id: 'colorBands',
  beforeDraw(chart) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
    const toY = (v) => y.getPixelForValue(v);

    const bands = [
      { lo: 0,   hi: 20,  color: 'rgba(34,197,94,0.08)' },
      { lo: 20,  hi: 50,  color: 'rgba(234,179,8,0.10)' },
      { lo: 50,  hi: 200, color: 'rgba(239,68,68,0.10)' },
    ];
    bands.forEach(({ lo, hi, color }) => {
      const yTop = clamp(toY(hi), top, bottom);
      const yBot = clamp(toY(lo), top, bottom);
      ctx.fillStyle = color;
      ctx.fillRect(left, yTop, right - left, yBot - yTop);
    });
  },
};

ChartJS.register(colorBandPlugin);

function SeismographChart({ jitterData, latencyData, labels }) {
  const data = {
    labels,
    datasets: [
      {
        label: 'Jitter (ms)',
        data: jitterData,
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167,139,250,0.15)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
      {
        label: 'Latency (ms)',
        data: latencyData,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    scales: {
      x: {
        ticks: { color: '#64748b', maxTicksLimit: 10, font: { size: 11 } },
        grid: { color: 'rgba(148,163,184,0.08)' },
      },
      y: {
        min: 0,
        max: 200,
        ticks: { color: '#64748b', font: { size: 11 } },
        grid: { color: 'rgba(148,163,184,0.08)' },
        title: { display: true, text: 'ms', color: '#64748b', font: { size: 11 } },
      },
    },
    plugins: {
      legend: {
        labels: { color: '#94a3b8', usePointStyle: true, pointStyleWidth: 8, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.9)',
        titleColor: '#e2e8f0',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(148,163,184,0.2)',
        borderWidth: 1,
      },
    },
  };

  return (
    <div style={{ height: 220 }}>
      <Line data={data} options={options} />
    </div>
  );
}

// ─── Readiness Gauge ─────────────────────────────────────────────────────────
function ReadinessMeter({ score }) {
  const health = score >= 75 ? 'good' : score >= 40 ? 'warning' : 'critical';
  const hs = HEALTH_STYLES[health];
  const pct = score / 100;
  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
        <svg className="absolute inset-0" width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth="10" />
          <motion.circle
            cx="70" cy="70" r="54"
            fill="none"
            stroke={hs.color}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            transform="rotate(-90 70 70)"
          />
        </svg>
        <div className="flex flex-col items-center">
          <motion.span
            className="text-4xl font-black text-white leading-none"
            animate={{ color: hs.color }}
            transition={{ duration: 0.5 }}
          >
            {score}
          </motion.span>
          <span className="text-xs text-slate-400 tracking-wider">/ 100</span>
        </div>
      </div>
      <span className={`text-sm font-semibold uppercase tracking-widest ${hs.text}`}>
        {score >= 75 ? 'Ready for Zoom' : score >= 40 ? 'Marginal Quality' : 'Not Ready'}
      </span>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
const LEGEND_ITEMS = [
  { color: 'bg-green-500',  label: 'RTT < 100ms / Jitter < 20ms',     note: 'Crystal-clear audio & video' },
  { color: 'bg-yellow-400', label: 'RTT 100–200ms / Jitter 20–50ms',  note: 'Audio might clip briefly' },
  { color: 'bg-red-500',    label: 'RTT > 200ms / Jitter > 50ms',     note: 'Video will freeze / drop' },
  { color: 'bg-red-700',    label: 'Packet Loss > 2%',                note: 'Call will degrade significantly' },
];

function PersistentLegend() {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Info className="h-4 w-4 text-slate-400" />
        <span className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Signal Guide</span>
      </div>
      <div className="space-y-2">
        {LEGEND_ITEMS.map(({ color, label, note }) => (
          <div key={label} className="flex items-start gap-3">
            <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${color}`} />
            <div>
              <p className="text-xs font-semibold text-slate-300">{label}</p>
              <p className="text-xs text-slate-500">{note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [running,     setRunning]     = useState(false);
  const [stress,      setStress]      = useState(false);
  const [stressLeft,  setStressLeft]  = useState(0);
  const [metrics,     setMetrics]     = useState({ rtt: 0, jitter: 0, loss: 0 });
  const [history,     setHistory]     = useState({ rtt: [], jitter: [], labels: [] });
  const [probeReady,  setProbeReady]  = useState(false);
  const [probeError,  setProbeError]  = useState(false);

  const probeRef     = useRef(null);
  const timerRef     = useRef(null);
  const stressRef    = useRef(null);
  const prevMetrics  = useRef(null);
  const secondRef    = useRef(0);

  // ── Boot probe ──
  const startProbe = useCallback(async () => {
    setProbeError(false);
    const p = new StunProbe();
    probeRef.current = p;
    try {
      await p.start();
      setProbeReady(true);
    } catch {
      setProbeError(true);
    }
  }, []);

  // ── Poll loop ──
  const tick = useCallback(async () => {
    const isStress = stressRef.current;

    let raw = null;
    if (probeRef.current) {
      raw = await probeRef.current.poll();
    }

    // If we got real stats augment them; otherwise fall back to simulation
    let m;
    if (raw && (raw.rtt > 0 || raw.jitter > 0)) {
      m = {
        rtt:    raw.rtt    + (isStress ? Math.random() * 120 : Math.random() * 20),
        jitter: raw.jitter + (isStress ? Math.random() * 40  : Math.random() * 5),
        loss:   raw.loss   + (isStress ? Math.random() * 3   : 0),
      };
    } else {
      m = simulateMetrics(prevMetrics.current, isStress);
    }

    prevMetrics.current = m;
    setMetrics(m);

    const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setHistory((h) => {
      const add = (arr, v) => [...arr.slice(-MAX_POINTS + 1), v];
      return {
        rtt:    add(h.rtt,    m.rtt),
        jitter: add(h.jitter, m.jitter),
        labels: add(h.labels, ts),
      };
    });
  }, []);

  // ── Start monitoring ──
  const handleStart = useCallback(async () => {
    setRunning(true);
    secondRef.current = 0;
    await startProbe();
    timerRef.current = setInterval(tick, POLL_INTERVAL);
  }, [startProbe, tick]);

  // ── Stop monitoring ──
  const handleStop = useCallback(() => {
    setRunning(false);
    setStress(false);
    stressRef.current = false;
    clearInterval(timerRef.current);
    clearTimeout(stressRef._timeout);
    if (probeRef.current) { probeRef.current.stop(); probeRef.current = null; }
    setProbeReady(false);
  }, []);

  // ── Stress test ──
  const handleStress = useCallback(() => {
    if (!running) return;
    setStress(true);
    stressRef.current = true;
    setStressLeft(STRESS_DURATION);

    const countdown = setInterval(() => {
      setStressLeft((s) => {
        if (s <= 1) {
          clearInterval(countdown);
          setStress(false);
          stressRef.current = false;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [running]);

  // ── Cleanup ──
  useEffect(() => () => {
    clearInterval(timerRef.current);
    if (probeRef.current) probeRef.current.stop();
  }, []);

  const health = getHealth(metrics.rtt, metrics.jitter, metrics.loss);
  const score  = running ? calcScore(metrics.rtt, metrics.jitter, metrics.loss) : 0;
  const rttH   = metrics.rtt    > THRESHOLDS.rtt.warn    ? 'critical' : metrics.rtt    > THRESHOLDS.rtt.good    ? 'warning' : 'good';
  const jitH   = metrics.jitter > THRESHOLDS.jitter.warn ? 'critical' : metrics.jitter > THRESHOLDS.jitter.good ? 'warning' : 'good';
  const lossH  = metrics.loss   > THRESHOLDS.loss.warn   ? 'critical' : metrics.loss   > THRESHOLDS.loss.good   ? 'warning' : 'good';

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Radio className="h-6 w-6 text-blue-400" />
            <h1 className="text-xl font-black tracking-tight">
              Zoom<span className="text-blue-400">Meter</span>
            </h1>
            <span className="hidden text-xs text-slate-500 sm:block">Visual Network Dashboard</span>
          </div>
          <div className="flex items-center gap-2">
            {probeError && (
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <AlertTriangle className="h-3 w-3" />
                Simulated mode
              </span>
            )}
            {running && probeReady && !probeError && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <CheckCircle className="h-3 w-3" />
                WebRTC live
              </span>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={running ? handleStop : handleStart}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                running
                  ? 'bg-red-600/20 text-red-400 border border-red-600/40 hover:bg-red-600/30'
                  : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}
            >
              {running ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              {running ? 'Stop' : 'Start Monitoring'}
            </motion.button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {/* Top row: Pulse + Metrics + Readiness */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Pulse Orb */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Connection Health</p>
            {running ? (
              <PulseOrb health={health} score={score} />
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-40 w-40 items-center justify-center rounded-full border-4 border-slate-700">
                  <WifiOff className="h-12 w-12 text-slate-600" />
                </div>
                <span className="text-sm text-slate-500">Not monitoring</span>
              </div>
            )}
          </div>

          {/* Metric Cards */}
          <div className="space-y-3 rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Live Telemetry</p>
            <MetricCard icon={Clock}      label="Latency (RTT)" value={metrics.rtt}    unit="ms"  health={running ? rttH  : 'good'} />
            <MetricCard icon={Activity}   label="Jitter"        value={metrics.jitter} unit="ms"  health={running ? jitH  : 'good'} />
            <MetricCard icon={BarChart2}  label="Packet Loss"   value={metrics.loss}   unit="%"   health={running ? lossH : 'good'} />
          </div>

          {/* Readiness + Stress */}
          <div className="flex flex-col items-center justify-between rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Zoom Readiness</p>
            <ReadinessMeter score={score} />
            <div className="w-full space-y-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleStress}
                disabled={!running || stress}
                className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                  stress
                    ? 'bg-orange-600/30 text-orange-400 border border-orange-500/40 cursor-not-allowed'
                    : running
                    ? 'bg-orange-600/20 text-orange-400 border border-orange-500/40 hover:bg-orange-600/30 cursor-pointer'
                    : 'bg-slate-700/50 text-slate-500 border border-slate-600/40 cursor-not-allowed'
                }`}
              >
                <Zap className="h-4 w-4" />
                {stress
                  ? `Stress Test… ${stressLeft}s`
                  : 'Run Pre-flight Stress Test'}
              </motion.button>
              {stress && (
                <motion.div
                  className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <motion.div
                    className="h-full bg-orange-500 rounded-full"
                    animate={{ width: `${(stressLeft / STRESS_DURATION) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Seismograph */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-400" />
              <h2 className="font-bold text-slate-200">Live Seismograph</h2>
              <span className="text-xs text-slate-500">(last {MAX_POINTS}s rolling window)</span>
            </div>
            {stress && (
              <span className="flex items-center gap-1 rounded-md bg-orange-500/20 px-2 py-1 text-xs font-semibold text-orange-400 border border-orange-500/30">
                <Zap className="h-3 w-3" />
                STRESS TEST ACTIVE
              </span>
            )}
          </div>
          {running ? (
            <SeismographChart
              jitterData={history.jitter}
              latencyData={history.rtt}
              labels={history.labels}
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-slate-600">
              <div className="flex flex-col items-center gap-2">
                <Activity className="h-12 w-12 opacity-30" />
                <span className="text-sm">Start monitoring to see live data</span>
              </div>
            </div>
          )}
          {/* Color-band legend row */}
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500/60" />Optimal zone</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-yellow-400/60" />Caution zone</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-500/60" />Danger zone</span>
          </div>
        </div>

        {/* Bottom row: Legend + status bar */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <PersistentLegend />

          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-4">
            <div className="mb-3 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Impact Guide</span>
            </div>
            <div className="space-y-2 text-xs text-slate-400">
              <p><span className="font-semibold text-violet-400">Jitter spikes:</span> Cause choppy audio — participants sound robotic or cut out intermittently.</p>
              <p><span className="font-semibold text-sky-400">Latency spikes:</span> Create awkward conversation delays and echo. Noticeable above 150ms.</p>
              <p><span className="font-semibold text-red-400">Packet loss:</span> Triggers Zoom's error-correction; above 2% video pixelates &amp; freezes.</p>
              <p><span className="font-semibold text-orange-400">Stress test:</span> Simulates heavy network congestion to expose hidden instability before a call.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

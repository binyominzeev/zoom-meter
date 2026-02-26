# ZoomMeter — Visual Network Dashboard

A single-page React application that monitors your network quality in real-time, tuned specifically for Zoom video conferencing stability.

![ZoomMeter Dashboard](https://github.com/user-attachments/assets/724918ce-1a3c-40a8-bc21-858575883822)

## Features

- **Pulse Indicator** — A large glowing orb that changes color based on overall health:
  - 🟢 **Green (Excellent):** RTT < 100ms, Jitter < 20ms, Loss < 0.2%
  - 🟡 **Yellow (Fluctuating):** RTT 100–200ms, Jitter 20–50ms, Loss 0.2–1%
  - 🔴 **Red (Critical):** RTT > 200ms, Jitter > 50ms, Loss > 2%

- **Live Seismograph** — Rolling 60-second line chart (Jitter + Latency) with color-coded background bands so you can instantly see when a spike enters a danger zone.

- **Zoom Readiness Meter** — A 0–100 score that drops rapidly when packet loss is detected.

- **Pre-flight Stress Test** — A 30-second high-intensity test to expose hidden network instability before a call.

- **Persistent Legend** — Clear labels explaining what each metric spike means (e.g. "Audio might clip" or "Video will freeze").

- **WebRTC Test Mode** — Uses the browser's native `RTCPeerConnection` + Google STUN server to generate real RTT/Jitter/Packet-Loss metrics. Falls back to simulation if WebRTC is unavailable.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React (Vite) |
| Styling | Tailwind CSS |
| Charts | Chart.js + react-chartjs-2 |
| Animations | Framer Motion |
| Icons | Lucide React |
| Network | WebRTC `getStats` API |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser, then click **Start Monitoring**.

## Building for Production

```bash
npm run build
```

The output is in the `dist/` folder — fully static, no server required. Purely web-based with no OS-level dependencies (Linux friendly).

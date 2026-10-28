import { useHoldGesture } from '../../../core/useHoldGesture';
import type { AudioPlayer } from '../../../core/useAudioPlayer';

interface Props {
  player: AudioPlayer;
  /** 0..1 playback position: drives the VU needle and the ring round the footswitch. */
  progress: number;
  label: string;
  sublabel: string;
}

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

// VU meter geometry (viewBox 0 0 200 104, pivot below the face).
const PIVOT = { x: 100, y: 128 };
const SWEEP = 48; // degrees either side of centre
const REST = -SWEEP - 7; // needle parks just below the bottom of the scale
const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: PIVOT.x + r * Math.cos(a), y: PIVOT.y + r * Math.sin(a) };
};
const arc = (from: number, to: number, r: number) => {
  const a = polar(from, r);
  const b = polar(to, r);
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} A${r} ${r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
};
const TICKS = Array.from({ length: 11 }, (_, i) => -SWEEP + (i * 2 * SWEEP) / 10);
const SCALE = [
  { v: '20', at: 0 },
  { v: '10', at: 0.25 },
  { v: '5', at: 0.5 },
  { v: '0', at: 0.75 },
  { v: '+3', at: 1 },
];

/** The hold control: an oxblood stomp-box with LED, VU meter and a chrome footswitch. */
export function Pedal({ player, progress, label, sublabel }: Props) {
  const disabled = player.status === 'error';
  const hold = useHoldGesture({ active: player.holding, disabled, onPress: player.press, onRelease: player.release });
  const p = Math.min(1, Math.max(0, progress));
  const playing = player.holding && player.status === 'playing';
  const waiting = player.holding && player.status !== 'playing';

  const classes = [
    'pedal',
    `is-${player.status}`,
    player.holding && 'is-holding',
    playing && 'is-live',
    waiting && 'is-waiting',
    disabled && 'is-disabled',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} data-testid="hold" {...hold}>
      <span className="pedal-screw" data-corner="ts" aria-hidden="true" />
      <span className="pedal-screw" data-corner="te" aria-hidden="true" />
      <span className="pedal-screw" data-corner="bs" aria-hidden="true" />
      <span className="pedal-screw" data-corner="be" aria-hidden="true" />

      <span className="pedal-top" aria-hidden="true">
        <span className="pedal-jack" />
        <span className="pedal-led-wrap">
          <span className="pedal-led" />
        </span>
        <span className="pedal-jack" />
      </span>

      <span className="vu" aria-hidden="true">
        <svg viewBox="0 0 200 104">
          <defs>
            <radialGradient id="amp-vu-face" cx="50%" cy="100%" r="100%">
              <stop offset="0%" stopColor="#fff3cf" />
              <stop offset="70%" stopColor="#f0d99a" />
              <stop offset="100%" stopColor="#c9a65c" />
            </radialGradient>
          </defs>
          <rect className="vu-face" x="0" y="0" width="200" height="104" rx="8" fill="url(#amp-vu-face)" />
          <path className="vu-arc" d={arc(-SWEEP, SWEEP * 0.5, 92)} />
          <path className="vu-arc-red" d={arc(SWEEP * 0.5, SWEEP, 92)} />
          {TICKS.map((deg, i) => {
            const a = polar(deg, 92);
            const b = polar(deg, i % 2 === 0 ? 102 : 98);
            return (
              <line
                key={deg}
                className={deg > SWEEP * 0.5 ? 'vu-tick is-red' : 'vu-tick'}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
              />
            );
          })}
          {SCALE.map(({ v, at }) => {
            const pt = polar(-SWEEP + at * 2 * SWEEP, 78);
            return (
              <text key={v} className={at === 1 ? 'vu-num is-red' : 'vu-num'} x={pt.x} y={pt.y + 4}>
                {v}
              </text>
            );
          })}
          <text className="vu-label" x="100" y="78">
            VU
          </text>
          <g className="vu-needle-wrap" style={{ transform: `rotate(${REST + p * (SWEEP - REST)}deg)` }}>
            <g className="vu-needle">
              <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y - 104} />
            </g>
          </g>
          <rect className="vu-hood" x="0" y="88" width="200" height="16" />
          <rect className="vu-glass" x="0" y="0" width="200" height="104" rx="8" />
        </svg>
      </span>

      <span className="pedal-legend">
        <span className="pedal-label" data-testid="hold-label">
          {label}
        </span>
        <span className="pedal-sublabel">{sublabel}</span>
      </span>

      <span className="footswitch" aria-hidden="true">
        <svg className="footswitch-ring" viewBox="0 0 100 100">
          <circle className="ring-track" cx="50" cy="50" r={RING_R} />
          <circle
            className="ring-progress"
            cx="50"
            cy="50"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - p)}
          />
        </svg>
        <span className="footswitch-nut">
          <span className="footswitch-cap" />
        </span>
      </span>

      <span className="pedal-brand" dir="ltr" lang="en" aria-hidden="true">
        <span>RIFF</span>
        <i>✦</i>
        <span>DRIVE</span>
      </span>
    </button>
  );
}

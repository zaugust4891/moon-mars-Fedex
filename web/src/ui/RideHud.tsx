// Ride mode HUD 2.0: cut-corner neon glass panels in the Elite/flight-computer
// idiom. Pure overlay — every figure derives in rideMath.ts from engine
// outputs (burn schedule, trajectory series, the core's own μ☉).

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtMass, useSim } from '../state/store';
import {
  buildOdometer,
  burnProgress,
  dvRemainingKms,
  fmtClock,
  fmtDelay,
  fmtDistKm,
  osculating,
  relVelMarsKms,
  statsAt,
  AU_KM,
} from '../viz/rideMath';
import { matchFacts, type Fact, type FactCtx } from '../data/facts';
import { CAM_MODES } from '../viz/ride/cameras';
import { FactBubble } from './FactBubble';
import { cue } from '../viz/ride/cues';

const BUBBLE_MS = 16_000;
const GAP_MS = 4_500;

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rh-stat ${accent ? 'rh-accent' : ''}`}>
      <span className="rh-k">{label}</span>
      <span className="rh-v">
        {value}
        {sub ? <em>{sub}</em> : null}
      </span>
    </div>
  );
}

export function RideHud() {
  const { state, dispatch } = useSim();
  const traj = state.traj;
  const mr = state.selected;

  const odo = useMemo(
    () => (traj ? buildOdometer(traj.helio.tDays, traj.helio.craft) : null),
    [traj],
  );

  // ---- fact engine ----
  const [bubble, setBubble] = useState<Fact | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<Fact[]>([]);
  const lastShowRef = useRef(0);
  const lastTRef = useRef(0);
  const trajRef = useRef(traj);

  useEffect(() => {
    if (!traj || !mr || !odo) return;
    const now = performance.now();
    if (trajRef.current !== traj || (state.tDays < 0.25 && lastTRef.current > 5)) {
      seenRef.current.clear();
      queueRef.current = [];
      setBubble(null);
      trajRef.current = traj;
    }
    lastTRef.current = state.tDays;

    const ctx: FactCtx = { s: statsAt(traj, mr, odo, state.tDays), traj, mr };
    const matches = matchFacts(ctx, seenRef.current);
    if (matches.length) {
      for (const f of matches) seenRef.current.add(f.id);
      queueRef.current.push(...matches);
      if (queueRef.current.length > 2) queueRef.current = queueRef.current.slice(-2);
    }
    if (!bubble && queueRef.current.length && now - lastShowRef.current > GAP_MS) {
      const next = queueRef.current.shift()!;
      lastShowRef.current = now;
      cue('fact-spawn', { id: next.id });
      setBubble(next);
    }
  }, [state.tDays, traj, mr, odo, bubble]);

  useEffect(() => {
    if (!bubble) return;
    const id = window.setTimeout(() => setBubble(null), BUBBLE_MS);
    return () => window.clearTimeout(id);
  }, [bubble]);

  if (!traj || !mr || !odo) return null;
  const s = statsAt(traj, mr, odo, state.tDays);
  const burn = s.activeEvent;
  const factCtx: FactCtx = { s, traj, mr };
  const delivered = s.inOrbit && s.tDays > traj.tofDays + 0.8;
  const dvLeft = dvRemainingKms(mr, s.tDays);
  const relV = relVelMarsKms(traj, s.tDays);
  const orb = osculating(s.posKm, s.velKms);
  const etaDays = Math.max(traj.transitDays - s.tDays, 0);
  const prog = burnProgress(burn, s.tDays);

  return (
    <div className="ride-hud">
      <div className="rh-corner rh-tl" />
      <div className="rh-corner rh-tr" />
      <div className="rh-corner rh-bl" />
      <div className="rh-corner rh-br" />

      <div className="rh-top-left rh-panel">
        <div className="rh-clock mono">
          T+ {fmtClock(s.tDays)} <span className="rh-unit">ddd:hh:mm</span>
        </div>
        <div className={`rh-phase ${burn ? 'rh-phase-burn' : ''}`}>
          <span className="rh-chev" aria-hidden>
            ❯❯
          </span>
          {s.phase.toUpperCase()}
        </div>
        <div className="rh-eta mono">
          {s.inOrbit ? 'ON STATION · MARS ORBIT' : `ETA MARS T−${fmtClock(etaDays)}`}
        </div>
        <div className="rh-sys">{mr.name}</div>
      </div>

      <div className="rh-stats rh-panel mono">
        <div className="rh-sect">FLIGHT</div>
        <Stat label="VELOCITY" value={`${s.speedKms.toFixed(2)} km/s`} sub="heliocentric" accent />
        <Stat label="REL VEL MARS" value={`${relV.toFixed(2)} km/s`} />
        <Stat label="OSC ORBIT" value={`a ${orb.aAu.toFixed(2)} AU · e ${orb.e.toFixed(3)}`} />
        <Stat label="FLT PATH ∠" value={`${orb.fpaDeg >= 0 ? '+' : ''}${orb.fpaDeg.toFixed(1)}°`} />
        <div className="rh-sect">RANGE</div>
        <Stat
          label="EARTH"
          value={fmtDistKm(s.distEarthKm)}
          sub={s.distEarthKm > 0.01 * AU_KM ? `${(s.distEarthKm / AU_KM).toFixed(2)} AU` : undefined}
        />
        {s.inOrbit && s.orbitPeriAltKm != null ? (
          <Stat label="MARS ALT" value={fmtDistKm(s.orbitPeriAltKm)} sub="periapsis" accent />
        ) : (
          <Stat
            label="MARS"
            value={fmtDistKm(s.distMarsKm)}
            sub={s.distMarsKm > 0.01 * AU_KM ? `${(s.distMarsKm / AU_KM).toFixed(2)} AU` : undefined}
            accent={s.distMarsKm < 8e6}
          />
        )}
        <Stat label="ODOMETER" value={`${(s.odoKm / 1e6).toFixed(1)}M km`} />
        <Stat label="SIGNAL DELAY" value={fmtDelay(s.lightDelayS)} sub="one-way" />
        <div className="rh-sect">SYSTEMS</div>
        <Stat label="Δv REMAINING" value={`${dvLeft.toFixed(2)} km/s`} accent={dvLeft < 2.5 && !s.inOrbit} />
        <Stat label="STACK MASS" value={fmtMass(s.massKg)} />
        <Stat label="SOLAR FLUX" value={`${Math.round(s.solarWm2)} W/m²`} sub={`${Math.round((s.solarWm2 / 1361) * 100)}%`} />
        <div className="rh-stat">
          <span className="rh-k">PROPELLANT</span>
          <span className="rh-fuel">
            <span className="rh-fuel-bar">
              <span style={{ width: `${(s.fuelFrac * 100).toFixed(1)}%` }} />
            </span>
            {(s.fuelFrac * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="rh-route mono">
        <span className="rh-route-end">MOON</span>
        <div className="rh-route-bar">
          <div className="rh-route-fill" style={{ width: `${(s.progress * 100).toFixed(2)}%` }} />
          {traj.events
            .filter((ev) => ev.kind !== 'jettison')
            .map((ev) => (
              <div
                key={`${ev.name}-${ev.tDays}`}
                className="rh-route-ev"
                title={`${ev.name} — T+${ev.tDays.toFixed(1)}d`}
                style={{ left: `${Math.min((ev.tDays / traj.transitDays) * 100, 100).toFixed(2)}%` }}
              />
            ))}
          <div className="rh-route-craft" style={{ left: `${(s.progress * 100).toFixed(2)}%` }}>
            ▲
          </div>
        </div>
        <span className="rh-route-end">MARS</span>
        <span className="rh-route-pct">{(s.progress * 100).toFixed(1)}%</span>
      </div>

      <div className="rh-cams mono">
        {CAM_MODES.map((c) => {
          const disabled =
            (c.id === 'dock' && !(s.inOrbit && s.tDays > traj.tofDays + 0.15)) ||
            (c.id === 'approach' && s.distMarsKm > 2e7 && !s.inOrbit);
          return (
            <button
              key={c.id}
              className={state.rideCam === c.id ? 'on' : ''}
              disabled={disabled}
              onClick={() => dispatch({ type: 'RIDECAM', cam: c.id })}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {burn && (
        <div className={`rh-burn mono ${burn.kind === 'spiral' ? 'rh-burn-spiral' : ''}`}>
          <div>
            {burn.kind === 'spiral' ? '◈ LOW-THRUST' : '⚠ BURN'} · {burn.name.toUpperCase()}
            {burn.dvKms > 0 ? ` · Δv ${burn.dvKms.toFixed(2)} km/s` : ''}
          </div>
          {prog != null && prog < 1 && (
            <div className="rh-burnbar">
              <span style={{ width: `${(prog * 100).toFixed(1)}%` }} />
            </div>
          )}
        </div>
      )}

      {delivered && !burn && (
        <div className="rh-burn rh-delivered mono">✦ CARGO CAPTURED · HARD DOCK CONFIRMED</div>
      )}

      {bubble && <FactBubble fact={bubble} ctx={factCtx} onClose={() => setBubble(null)} />}

      <div className="rh-hint mono">drag · look — wheel · zoom — 2×click · recenter</div>
    </div>
  );
}

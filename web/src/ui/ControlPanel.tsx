// Simulation transport controls: play/pause/step/rewind, time warp,
// playback direction, view selection, vector/gravity-well toggles.

import { useSim, type AppView } from '../state/store';

const SPEEDS = [0.5, 1, 2, 5, 10, 25, 50, 100];

export function ControlPanel() {
  const { state, dispatch } = useSim();
  const t = state.traj;

  return (
    <div className="panel controls">
      <div className="row">
        <button onClick={() => dispatch({ type: 'REWIND' })} title="Rewind to t=0">⏮</button>
        <button onClick={() => dispatch({ type: 'STEP', days: -1 })} title="Step back 1 day">⏪</button>
        {state.playing ? (
          <button className="primary" onClick={() => dispatch({ type: 'PAUSE' })}>⏸ Pause</button>
        ) : (
          <button className="primary" onClick={() => dispatch({ type: 'PLAY' })}>▶ Play</button>
        )}
        <button onClick={() => dispatch({ type: 'STEP', days: 1 })} title="Step forward 1 day">⏩</button>
        <button
          className={state.direction === -1 ? 'active' : ''}
          onClick={() => dispatch({ type: 'DIRECTION', direction: state.direction === 1 ? -1 : 1 })}
          title="Toggle playback direction"
        >
          {state.direction === 1 ? '→' : '←'}
        </button>
        <button onClick={() => dispatch({ type: 'RESET' })} title="Reset simulation">↺ Reset</button>
      </div>

      <div className="row">
        <label>Warp</label>
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={state.speed === s ? 'active' : ''}
            onClick={() => dispatch({ type: 'SPEED', speed: s })}
          >
            {s}d/s
          </button>
        ))}
      </div>

      <div className="row">
        <label>View</label>
        {(
          [
            ['helio', 'Heliocentric'],
            ['departure', 'Lunar departure'],
            ['arrival', 'Mars arrival'],
            ['ride', '🚀 Ride along'],
          ] as [AppView, string][]
        ).map(([v, name]) => (
          <button
            key={v}
            className={state.view === v ? (v === 'ride' ? 'active ride-btn' : 'active') : v === 'ride' ? 'ride-btn' : ''}
            onClick={() => dispatch({ type: 'VIEW', view: v })}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={state.showVectors}
            onChange={() => dispatch({ type: 'TOGGLE', key: 'showVectors' })}
          />
          velocity / thrust vectors
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.showWell}
            onChange={() => dispatch({ type: 'TOGGLE', key: 'showWell' })}
          />
          gravity well
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.includeNbody}
            onChange={() => dispatch({ type: 'PARAM', patch: { includeNbody: !state.includeNbody } })}
          />
          N-body ghost path
        </label>
        {state.view === 'ride' && (
          <label title="Slows playback (not physics) around launch, MOI and rendezvous so second-scale events are watchable">
            <input
              type="checkbox"
              checked={state.cinematic}
              onChange={() => dispatch({ type: 'TOGGLE', key: 'cinematic' })}
            />
            🎬 cinematic pacing
          </label>
        )}
      </div>

      <div className="row scrub">
        <span className="mono">T+{state.tDays.toFixed(1)} d</span>
        <input
          type="range"
          min={0}
          max={t?.tEndDays ?? 270}
          step={0.25}
          value={state.tDays}
          onChange={(e) => dispatch({ type: 'SET_TIME', tDays: Number(e.target.value) })}
        />
        <span className="mono">{(t?.tEndDays ?? 0).toFixed(0)} d</span>
      </div>
    </div>
  );
}

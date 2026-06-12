import { useEffect, useRef } from 'react';
import { useSim } from './state/store';
import { MissionScene } from './viz/Scene';
import { RideScene } from './viz/RideScene';
import { ControlPanel } from './ui/ControlPanel';
import { ParameterPanel } from './ui/ParameterPanel';
import { MetricsPanel } from './ui/MetricsPanel';
import { Timeline } from './ui/Timeline';
import { ComparisonView } from './ui/ComparisonView';
import { RideHud } from './ui/RideHud';

export default function App() {
  const { state, dispatch } = useSim();
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MissionScene | null>(null);
  const rideRef = useRef<RideScene | null>(null);
  const isRide = state.view === 'ride';

  // scene lifecycle — must also re-run when `ready` flips: before the engine
  // loads the app renders the boot screen and the mount ref is null
  useEffect(() => {
    if (!mountRef.current || state.mode !== 'mission') return;
    if (isRide) {
      const scene = new RideScene(mountRef.current);
      scene.onModeChange = (cam) => dispatch({ type: 'RIDECAM', cam });
      rideRef.current = scene;
      const onResize = () => scene.resize();
      window.addEventListener('resize', onResize);
      return () => {
        window.removeEventListener('resize', onResize);
        scene.dispose();
        rideRef.current = null;
      };
    }
    const scene = new MissionScene(mountRef.current);
    sceneRef.current = scene;
    scene.resetCamera();
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [state.mode, state.ready, isRide]);

  useEffect(() => {
    if (!state.traj) return;
    sceneRef.current?.setTrajectory(state.traj);
    rideRef.current?.setTrajectory(state.traj);
  }, [state.traj, state.mode, isRide]);

  useEffect(() => {
    rideRef.current?.setMission(state.selected);
  }, [state.selected, state.traj, state.mode, isRide]);

  useEffect(() => {
    rideRef.current?.setCamMode(state.rideCam);
  }, [state.rideCam, state.mode, isRide]);

  useEffect(() => {
    if (state.view !== 'ride') sceneRef.current?.setView(state.view);
  }, [state.view, state.mode]);

  useEffect(() => {
    sceneRef.current?.setOptions({
      showVectors: state.showVectors,
      showWell: state.showWell,
      showNbody: state.includeNbody,
    });
  }, [state.showVectors, state.showWell, state.includeNbody, state.traj, state.mode]);

  useEffect(() => {
    sceneRef.current?.setTime(state.tDays);
    rideRef.current?.setTime(state.tDays);
  }, [state.tDays, state.traj, state.view, state.mode]);

  if (state.error) {
    return (
      <div className="boot error">
        <h2>Engine failed to load</h2>
        <pre>{state.error}</pre>
        <p>
          Build the WASM core first: <code>cd sim-core && cargo build --release --target
          wasm32-unknown-unknown</code> then copy <code>sim_core.wasm</code> into{' '}
          <code>web/public/</code> (or run <code>npm run wasm</code>).
        </p>
      </div>
    );
  }
  if (!state.ready) {
    return <div className="boot">Loading physics core (Rust/WASM)…</div>;
  }

  return (
    <div className="app">
      <header>
        <h1>fable-moon · Lunar→Mars Cargo Mission Simulator</h1>
        <span className="sub">
          45,359 kg-class cargo · patched-conic + RKF45 N-body · Rust/WASM core
        </span>
      </header>
      <div className="layout">
        <aside>
          <ParameterPanel />
          <MetricsPanel />
        </aside>
        <main>
          {state.mode === 'mission' ? (
            <>
              <div className="viewport" ref={mountRef}>
                {isRide && <RideHud />}
              </div>
              <Timeline />
              <ControlPanel />
            </>
          ) : (
            <ComparisonView />
          )}
        </main>
      </div>
    </div>
  );
}

// Holographic "Mission Intel" artifacts. Five visually distinct frame designs
// are assigned deterministically per fact; spawn vectors are seeded from the
// fact id so each card materializes from a different point in deep space and
// drifts to its dock. Pure DOM/CSS — pointer events enabled only on the card.

import { useMemo, type CSSProperties } from 'react';
import type { Fact, FactCtx } from '../data/facts';

const DESIGNS = ['fb-hex', 'fb-iris', 'fb-shard', 'fb-slab', 'fb-core'] as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function FactBubble({
  fact,
  ctx,
  onClose,
}: {
  fact: Fact;
  ctx: FactCtx;
  onClose: () => void;
}) {
  const seed = useMemo(() => hash(fact.id), [fact.id]);
  const design = DESIGNS[seed % DESIGNS.length];
  const style = useMemo(() => {
    const r1 = ((seed >> 3) % 1000) / 1000;
    const r2 = ((seed >> 7) % 1000) / 1000;
    const r3 = ((seed >> 11) % 1000) / 1000;
    // spawn from a random deep-space point (biased up/left of the dock),
    // with a per-artifact rotation and drift duration
    return {
      '--sx': `${(-72 + r1 * 50).toFixed(1)}vw`,
      '--sy': `${(-12 + r2 * 56).toFixed(1)}vh`,
      '--rot': `${(r3 * 26 - 13).toFixed(1)}deg`,
      '--dur': `${(1.1 + r1 * 0.7).toFixed(2)}s`,
    } as CSSProperties;
  }, [seed]);

  return (
    <div className={`fb ${design} fb-t-${fact.tag.toLowerCase()}`} style={style} key={fact.id}>
      <div className="fb-aura" aria-hidden />
      {design === 'fb-iris' && <div className="fb-irisring" aria-hidden />}
      {design === 'fb-core' && (
        <div className="fb-orbiters" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="fb-frame">
        <div className="fb-head">
          <span className="fb-tag">{fact.tag}</span>
          <span className="fb-title">{fact.title}</span>
          <button className="fb-x" onClick={onClose} aria-label="dismiss">
            ✕
          </button>
        </div>
        <p className="fb-text">{fact.text(ctx)}</p>
        <div className="fb-foot">
          <span className="fb-id mono">INTEL//{fact.id.toUpperCase().replace(/-/g, '_')}</span>
          <span className="fb-life" />
        </div>
      </div>
      <div className="fb-scan" aria-hidden />
    </div>
  );
}

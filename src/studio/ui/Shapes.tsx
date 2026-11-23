/**
 * The kit's pieces drawn flat: a dark disc with its slits as light lines to the centre. Shared by the hero, the
 * scroll story and anywhere else a piece is named.
 */

export type ShapeKind = 'c1' | 'c2l' | 'c2i' | 'c3t' | 'disc' | 'half' | 'notched';

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  c1: 'Disc, 1 slit', c2l: 'Disc, 2 slits at 90°', c2i: 'Disc, 2 slits at 180°', c3t: 'Disc, 3 slits', disc: 'Disc', half: 'Half disc, 1 slit', notched: 'Half disc, 2 notches',
};

/** Slit mouths per piece, as unit directions (y down, as on screen). The half disc's one slit runs along a radius,
 * from the middle of its curved edge, stopping short of the centre like the others. */
const SLITS: Record<Exclude<ShapeKind, 'half' | 'notched'>, [number, number][]> = {
  c1: [[0, -1]], c2l: [[0, -1], [1, 0]], c2i: [[0, -1], [0, 1]], c3t: [[0, -1], [0, 1], [1, 0]], disc: [],
};

const R = 48;
/**
 * Where a slit stops, as a share of the radius from the centre. Two joined discs sit about 1.04 radii apart, so
 * each slit runs in just under half a radius from the edge and stops short of the centre (as the kit cuts them).
 */
const STOP = 0.52;

export function Shape({kind, slit = '#fff', width = 2.6, label = true, className}: {kind: ShapeKind; slit?: string; width?: number; label?: boolean; className?: string}) {
  return (
    <svg className={className} viewBox="-50 -50 100 100" role={label ? 'img' : undefined} aria-label={label ? SHAPE_NAMES[kind] : undefined} aria-hidden={label ? undefined : true}>
      <g fill="#2B2B2B">
        {kind === 'notched' ? (
          <>
            <path d={`M0 ${-R}A${R} ${R} 0 0 1 0 ${R}Z`} />
            {[-1, 1].map(y => <line key={y} className="slit" x1={width} y1={y * R} x2={width} y2={y * R * STOP} stroke={slit} strokeWidth={width} pathLength={1} />)}
          </>
        ) : kind === 'half' ? (
          <>
            <path d={`M0 ${-R}A${R} ${R} 0 0 1 0 ${R}Z`} />
            <line className="slit" x1={R} y1={0} x2={R * STOP} y2={0} stroke={slit} strokeWidth={width} pathLength={1} />
          </>
        ) : (
          <>
            <circle r={R} />
            {SLITS[kind].map(([x, y], i) => <line key={i} className="slit" x1={x * R} y1={y * R} x2={x * R * STOP} y2={y * R * STOP} stroke={slit} strokeWidth={width} pathLength={1} />)}
          </>
        )}
      </g>
    </svg>
  );
}

/** One P of the mark: a square stem, a bowl with a round end and a counter with a round end, on the logo's grid. */
const MARK_P = 'M95 83H165A44.5 44.5 0 0 1 165 172H128V228H95ZM128 116V140H168A12 12 0 0 0 168 116Z';

/**
 * The Probable Pieces mark: a P, and the same P turned half round (a d), its bowl tucked under the P's and its stem
 * against the P's bowl, as drawn on the logo grid.
 */
export function Mark({className}: {className?: string}) {
  return (
    <svg className={`pp-mark ${className ?? ''}`} viewBox="93 81 154 197" role="img" aria-label="Probable Pieces">
      <path d={MARK_P} fillRule="evenodd" />
      <path d={MARK_P} fillRule="evenodd" transform="rotate(180 170 179.5)" />
    </svg>
  );
}

/** A dotted arrow pointing right: a row of dots ending in a chevron of dots. */
export function DotArrow({className = 'pa-arrow'}: {className?: string}) {
  // A shaft of dots, and two arms running back from the tip at 45°.
  const dots: [number, number][] = [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0], [25, 0], [30, 0], [25, -5], [20, -10], [15, -15], [25, 5], [20, 10], [15, 15]];
  return <svg className={className} viewBox="-3 -18 37 36" aria-hidden>{dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.9} />)}</svg>;
}


/**
 * The way on to the next part of the page: the dotted arrow turned to point down. `onClick` can take the step
 * instead (return true to stay put); otherwise it scrolls to the section after the one it sits in.
 */
export function DownArrow({label = 'Next', onClick, className = ''}: {label?: string; onClick?: () => boolean | void; className?: string}) {
  return (
    <button type="button" className={`pp-down ${className}`} aria-label={label} onClick={e => {
      if (onClick?.()) return;
      const next = e.currentTarget.closest('section')?.nextElementSibling;
      next?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    }}>
      <DotArrow className="pp-down-arrow" />
    </button>
  );
}

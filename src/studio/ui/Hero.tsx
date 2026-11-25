import {DownArrow, Shape, SHAPE_NAMES, type ShapeKind} from './Shapes';
import {StudioNav} from './Nav';

/**
 * The opening of the scroll, split down the middle: the Probable Pieces poster filling the left half in yellow, the
 * kit's slot shapes on white on the right. Letters sit where
 * the poster puts them (centres as a share of the poster's width and height, turned as printed); they fall into
 * place once on load.
 */

// [letter, x %, y %, turn in degrees]
const PIECES: [string, number, number, number][] = [
  ['P', 7.7, 8.4, 0], ['I', 7.7, 20.9, 0], ['E', 8.7, 33.7, 0], ['C', 8.7, 46.5, 0], ['E', 8.7, 59.3, 0], ['S', 8.7, 72.4, 0],
];
const PROBABLE: [string, number, number, number][] = [
  ['R', 22.2, 9.4, -22], ['O', 32.9, 18.9, 0], ['B', 47.3, 19.2, 0], ['A', 59.9, 27.6, -16], ['B', 59.9, 40.4, -36], ['L', 70.5, 48.1, 0], ['E', 70.5, 59.4, 0],
];

export function Hero({onContinue}: {onContinue: () => boolean}) {
  return (
    <>
      <StudioNav current="pieces" />
      <section className="pp-hero" aria-label="Probable Pieces">
        <div className="pp-hero-poster">
          <div className="pp-poster">
            <h1 className="pp-title" aria-label="Probable Pieces">
              {[...PIECES, ...PROBABLE].map(([ch, x, y, deg], i) => (
                <span key={i} aria-hidden style={{left: `${x}%`, top: `${y}%`, ['--turn' as string]: `${deg}deg`, ['--i' as string]: i}}>{ch}</span>
              ))}
            </h1>
            <p className="pp-credit">Maya Kiernan &amp;<br />Andrew Gorovoy</p>
          </div>
        </div>
        <div className="pp-hero-shapes"><SlotShapes /></div>
        <DownArrow onClick={onContinue} />
      </section>
    </>
  );
}

const HERO_SHAPES: ShapeKind[] = ['c1', 'c2l', 'c2i', 'c3t', 'half'];

/** The slot shapes: one slit, an L, two opposite slits, a T, a plain disc and a half disc. */
function SlotShapes() {
  return (
    <ul className="pp-shapes" aria-label="Slot shapes">
      {HERO_SHAPES.map(k => <li key={k} title={SHAPE_NAMES[k]}><Shape kind={k} /></li>)}
    </ul>
  );
}

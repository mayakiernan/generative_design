import {useState} from 'react';
import {DownArrow, Mark, Shape, type ShapeKind} from './Shapes';

/** Every piece of the kit a plain circle becomes once it is slotted, in the order they fan out. */
const SET: ShapeKind[] = ['c1', 'c2l', 'c2i', 'c3t', 'half'];

/**
 * The second beat of the scroll: one plain circle, "PIECE". Clicking it fans it out into the slotted pieces,
 * "PIECES…", their slits drawing in; clicking again folds them back.
 */
export function PieceStory() {
  const [open, setOpen] = useState(false);
  return (
    <section className={`pp-slide pp-piece${open ? ' open' : ''}`} aria-label="Pieces">
      <Mark className="pp-slide-mark" />
      <h2 className="pp-slide-title" aria-live="polite">{open ? 'PIECES…' : 'PIECE'}</h2>
      <button type="button" className="pp-set" aria-expanded={open} aria-label={open ? 'Fold the pieces back into one circle' : 'Open the circle into the pieces'} onClick={() => setOpen(o => !o)}>
        {SET.map((k, i) => (
          <span key={k} className="pp-set-piece" style={{['--i' as string]: i, ['--n' as string]: SET.length}}>
            <Shape kind={k} slit="#dcdcd6" width={3.4} label={false} />
          </span>
        ))}
        <span className="pp-hint" aria-hidden><b>&gt;</b> circle</span>
      </button>
      <DownArrow />
    </section>
  );
}

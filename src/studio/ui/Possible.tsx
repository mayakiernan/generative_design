import {DotArrow} from './Shapes';

/** The way into the atlas, shown at the last step of the design-space count. */
export function PossibleLink() {
  return (
    <a className="pp-possible-link" href="../atlas/">
      <span>See what’s possible</span>
      <DotArrow className="pp-possible-arrow" />
    </a>
  );
}

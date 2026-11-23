import {DotArrow} from './Shapes';

/** The end of the scroll: the way into the atlas. */
export function Possible() {
  return (
    <section className="pp-possible" aria-label="See what's possible">
      <a className="pp-possible-link" href="atlas/">
        <span>See what’s possible</span>
        <DotArrow className="pp-possible-arrow" />
      </a>
      <nav className="pp-foot" aria-label="More">
        <a href="forms/">Form counts</a>
        <a href="blog/">Blog</a>
      </nav>
    </section>
  );
}

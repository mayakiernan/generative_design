import {useEffect, useRef} from 'react';
import {PieceStory} from './PieceStory';
import {DesignSpace} from './DesignSpace';
import {Possible} from './Possible';

export default function LandingStory() {
  const story = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = story.current;
    if (!section) return;
    section.focus({preventScroll: true});
    section.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  }, []);

  return (
    <main ref={story} tabIndex={-1} aria-label="The Possible Pieces story">
      <PieceStory />
      <DesignSpace />
      <Possible />
    </main>
  );
}

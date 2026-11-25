import {lazy, Suspense, useState} from 'react';
import {PieceStory} from './PieceStory';

const DesignSpace = lazy(() => import('./DesignSpace').then(module => ({default: module.DesignSpace})));

function focusAndScroll(section: HTMLElement | null) {
  if (!section) return;
  section.focus({preventScroll: true});
  section.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

export default function LandingStory() {
  const [showDesignSpace, setShowDesignSpace] = useState(false);

  function revealDesignSpace() {
    if (showDesignSpace) return false;
    setShowDesignSpace(true);
    return true;
  }

  return (
    <main ref={focusAndScroll} tabIndex={-1} aria-label="The Possible Pieces story">
      <PieceStory onContinue={revealDesignSpace} />
      {showDesignSpace && (
        <Suspense fallback={null}>
          <div ref={focusAndScroll} tabIndex={-1} role="region" aria-label="Design space">
            <DesignSpace />
          </div>
        </Suspense>
      )}
    </main>
  );
}

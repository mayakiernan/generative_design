import React, {lazy, Suspense, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Hero} from './studio/ui/Hero';
import './slots.css';
import './studio.css';

const LandingStory = lazy(() => import('./studio/ui/LandingStory'));

function Landing() {
  const [showStory, setShowStory] = useState(false);

  function revealStory() {
    if (showStory) return false;
    setShowStory(true);
    return true;
  }

  return (
    <>
      <Hero onContinue={revealStory} />
      {showStory && <Suspense fallback={null}><LandingStory /></Suspense>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Landing /></React.StrictMode>);

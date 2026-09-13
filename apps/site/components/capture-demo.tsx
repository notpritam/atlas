'use client';
import {useRef,useState} from 'react';
export function CaptureDemo(){const [saved,setSaved]=useState(false);const saveRef=useRef<HTMLButtonElement>(null),resetRef=useRef<HTMLButtonElement>(null);const save=()=>{setSaved(true);requestAnimationFrame(()=>resetRef.current?.focus({preventScroll:true}));};const reset=()=>{setSaved(false);requestAnimationFrame(()=>saveRef.current?.focus({preventScroll:true}));};return (<div className="capture-stage">
            <div className="capture-demo" data-capture-demo="">
              <div className="demo-source">
                <div className="demo-source-bar">
                  <span className="window-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>Field notes · illustrative demo</span><svg aria-hidden="true" viewBox="0 0 24 24">
                    <use href="#i-external"></use>
                  </svg>
                </div>
                <div className="demo-source-content">
                  <div className="article-byline">
                    A small thought for your next adventure
                  </div>
                  <h3>Leave a little room<br />for the unexpected.</h3>
                  <p>
                    Some ideas arrive before you have a place for them.
                    <mark id="demo-selection" className={saved ? "is-saved" : ""}>A good collection starts with noticing.</mark>
                    Save the detail now. Come back to the possibility later.
                  </p>
                  <div className="demo-source-bottom">
                    <span>Found something?</span><button className="button demo-save" type="button" id="demoSave" disabled={saved} onClick={save} ref={saveRef}>
                      Save this highlight
                      <svg aria-hidden="true" viewBox="0 0 24 24">
                        <use href="#i-plus"></use>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
              <div className="demo-destination">
                <div className="demo-library-heading">
                  <img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="25" height="25" alt="" aria-hidden="true" /><strong>Your collection</strong><span id="demoCount">{saved ? '1 item' : '0 items'}</span>
                </div>
                <div className="demo-empty" id="demoEmpty" hidden={saved}>
                  <div className="empty-bookmark">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-bookmark"></use>
                    </svg>
                  </div>
                  <h3>Something good<br />is on its way.</h3>
                  <p>Try saving the highlighted sentence.</p>
                </div>
                <article className="demo-saved" id="demoSaved" hidden={!saved}>
                  <span className="saved-kind"><svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-highlight"></use>
                    </svg>
                    Highlight</span>
                  <h3>A good collection starts with noticing.</h3>
                  <p>Leave a little room for the unexpected.</p>
                  <span className="saved-source"><svg aria-hidden="true" viewBox="0 0 24 24">
                      <use href="#i-link"></use>
                    </svg>
                    Field notes · sample source</span>
                  <div className="saved-footer">
                    <span><svg aria-hidden="true" viewBox="0 0 24 24">
                        <use href="#i-check"></use>
                      </svg>
                      Saved in this demo</span><button id="demoReset" className="reset-button" type="button" onClick={reset} ref={resetRef}>
                      Try again
                    </button>
                  </div>
                </article>
              </div>
            </div>
            <p className="demo-disclosure" id="demoStatus" role="status">{saved ? 'Highlight saved in this illustration. Your Foundkeep library has not changed.' : 'Try it here. This demo does not save to your Foundkeep library.'}</p>
            <div className="floating-note" aria-hidden="true">
              A little less lost. A lot more found.
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <use href="#i-check"></use>
              </svg>
            </div>
          </div>);}

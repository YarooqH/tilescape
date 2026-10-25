import type { SceneInfo } from '../scene';
import { blackHole } from './blackhole';
import { deepSpace } from './deepspace';
import { dragon } from './dragon';
import { koiPond } from './koi';
import { murmuration } from './murmuration';
import { planets } from './planets';
import { fallingSand } from './sand';
import { smokeFire } from './smoke';
import { topographic } from './topo';
import { vines } from './vines';

export const SCENES: SceneInfo[] = [
  { id: 'falling-sand', label: 'falling sand', hint: '{click} and hold to pour sand', create: fallingSand },
  { id: 'topographic', label: 'topographic map', hint: '{click} and hold to raise a hill', create: topographic },
  { id: 'dragon', label: 'dragon', hint: '{click} to toss the pearl', create: dragon },
  { id: 'black-hole', label: 'black hole', hint: '{click} to drop a star in', create: blackHole },
  { id: 'planets', label: 'planets', hint: '{click} to fling a comet', create: planets },
  { id: 'deep-space', label: 'deep space', hint: '{click} to set off a supernova', create: deepSpace },
  { id: 'smoke-fire', label: 'smoke & fire', hint: '{click} for a puff of smoke', create: smokeFire },
  { id: 'murmuration', label: 'murmuration', hint: '{click} to send in a hawk', create: murmuration },
  { id: 'vines', label: 'vines', hint: '{click} to plant a seed', create: vines },
];

/** Kept working but out of the pickers. */
export const RETIRED_SCENES: SceneInfo[] = [{ id: 'koi-pond', label: 'koi pond', hint: '{click} to scatter food', create: koiPond }];

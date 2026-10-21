import type { Force } from './particles';
import type { Grid, World } from './world';

/** Paints the static backdrop; `ink(a)` is the ink colour at alpha `a`. */
export type Backdrop = (g: CanvasRenderingContext2D, world: World, grid: Grid, ink: (alpha: number) => string) => void;

export interface Scene {
  /** how strongly marks dissolve around the prompt: 0 never, 1 fully */
  readonly fog: number;
  resize(world: World): void;
  update(dt: number, world: World): void;
  /** write this frame's marks; the grid arrives cleared */
  raster(grid: Grid, world: World): void;
  /** replaces the default grid paper */
  background?: Backdrop;
  /** true when what the backdrop is drawn around has moved since it was last painted */
  backdropStale?(): boolean;
  /** extra motion for the shared particles while this scene is up */
  force?: Force;
  pointerDown?(x: number, y: number, world: World): void;
  /** a keystroke in the prompt */
  input?(world: World): void;
  submit?(text: string, world: World): void;
}

export interface SceneInfo {
  id: string;
  label: string;
  /** "{click}" becomes "tap" on touch screens */
  hint: string;
  create(world: World): Scene;
}

import type { Mode } from '../render';
import type { SceneInfo } from '../scene';

/** What a widget can do to the page around it. */
export interface Host {
  readonly scenes: readonly SceneInfo[];
  readonly widgets: readonly { id: string; label: string }[];
  scene(): SceneInfo;
  setScene(id: string): void;
  stepScene(by: number): void;
  mode(): Mode;
  setMode(mode: Mode): void;
  toggleTheme(): void;
  setWidget(id: string): void;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  /** a keystroke in a text field */
  input(): void;
  /** hand text to the scene; the burst rings `from` */
  submit(text: string, from: Element): void;
}

export interface Widget {
  /** everything the scene fogs around */
  root: HTMLElement;
  /** the solid part the scene steers around */
  card: HTMLElement;
  /** simulation seconds, slowed or stopped along with the scene */
  tick?(dt: number): void;
  sceneChanged?(info: SceneInfo): void;
  modeChanged?(mode: Mode): void;
  focus?(): void;
  destroy?(): void;
}

export interface WidgetInfo {
  id: string;
  label: string;
  create(host: Host): Widget;
}

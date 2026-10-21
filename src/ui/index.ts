import { notes } from './notes';
import { palette } from './palette';
import { player } from './player';
import { terminal } from './terminal';
import { thread } from './thread';
import type { WidgetInfo } from './types';
import { waitlist } from './waitlist';

export const WIDGETS: WidgetInfo[] = [
  { id: 'palette', label: 'palette', create: palette },
  { id: 'terminal', label: 'terminal', create: terminal },
  { id: 'thread', label: 'chat', create: thread },
  { id: 'waitlist', label: 'waitlist', create: waitlist },
  { id: 'notes', label: 'notebook', create: notes },
  { id: 'player', label: 'player', create: player },
];

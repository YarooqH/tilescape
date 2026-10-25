/** Ink colours for the scene. Each runs from the faintest mark to the densest, per theme. */
export interface Tint {
  id: string;
  label: string;
  /** null keeps the theme's own ink */
  light: [string, string] | null;
  dark: [string, string] | null;
}

export const TINTS: readonly Tint[] = [
  { id: 'graphite', label: 'graphite', light: null, dark: null },
  { id: 'ember', label: 'ember', light: ['#f59e0b', '#9a1b0b'], dark: ['#c2410c', '#ffd58a'] },
  { id: 'ocean', label: 'ocean', light: ['#38bdf8', '#0b3a6e'], dark: ['#1d6fa5', '#a5f0ff'] },
  { id: 'moss', label: 'moss', light: ['#84cc16', '#1d4a1f'], dark: ['#3f7a3a', '#d9f99d'] },
  { id: 'iris', label: 'iris', light: ['#a78bfa', '#3b0f80'], dark: ['#6d3fd1', '#f0d4ff'] },
  { id: 'coral', label: 'coral', light: ['#fb7185', '#7a1238'], dark: ['#be3a5c', '#ffd0b5'] },
];

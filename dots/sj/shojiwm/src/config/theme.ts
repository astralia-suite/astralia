import { signal } from "shoji_wm";

interface ThemeColors {
  accent: string;
  accentAlt: string;
  lavender: string;
  textDim: string;
  text: string;
}

// Color Palette
export const theme: ThemeColors = {
  accent: "#7B2FE8",
  accentAlt: "#C8942A",
  lavender: "#5E50A0",
  textDim: "#5E50A0",
  text: "#F0ECF8",
};

// Tiled-window borders. The shell replaces them over IPC (`theme.borders`)
// to follow the wallpaper palette; a reload starts from these defaults.
export const borderColors = signal({
  active: theme.accent,
  inactive: `${theme.textDim}AA`,
});

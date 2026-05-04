import { create } from "zustand";
import { THEMES, DEFAULT_THEME, type Theme } from "@/config/threejs/themes";

interface ThemeStore {
  themeName: string;
  theme: Theme;
  setTheme: (name: string) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  themeName: DEFAULT_THEME.name,
  theme: DEFAULT_THEME,
  setTheme: (name: string) => {
    const next = THEMES[name] ?? DEFAULT_THEME;
    set({ themeName: next.name, theme: next });
  },
}));

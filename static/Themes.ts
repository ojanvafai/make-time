interface Theme {
  name: string;
  styles: {
    '--border-and-hover-color': string; '--row-hover-color': string;
    '--nested-background-color': string;
    '--overlay-background-color': string;
    '--inverted-overlay-background-color': string;
    '--selected-background-color': string;
    '--text-color': string;
    '--dim-text-color': string;
    '--inverted-text-color': string;
    '--checkbox-indeterminate-color': string;
    '--main-background': string;
  }
}

export const DEFAULT: Theme = {
  name: 'Default',
  styles: {
    '--border-and-hover-color': '#ccc',
    '--row-hover-color': '#eee',
    '--nested-background-color': '#ffffffbb',
    '--overlay-background-color': '#fff',
    '--inverted-overlay-background-color': '#000',
    '--selected-background-color': '#c2dbff',
    '--text-color': '#000',
    '--dim-text-color': '#333',
    '--inverted-text-color': '#fff',
    '--checkbox-indeterminate-color': '#aaa',
    '--main-background': 'lavender',
  }
};

export const DARK: Theme = {
  name: 'Dark Mode',
  styles: {
    '--border-and-hover-color': '#333',
    '--row-hover-color': '#111',
    '--nested-background-color': '#000000bb',
    '--overlay-background-color': '#000',
    '--inverted-overlay-background-color': '#fff',
    '--selected-background-color': '#c2dbff',
    '--text-color': '#fff',
    '--dim-text-color': '#ccc',
    '--inverted-text-color': '#000',
    '--checkbox-indeterminate-color': '#888',
    '--main-background': '#000',
  }
};

const MAIN_BACKGROUND_PROPERTY = '--main-background';

export class Themes {
  static overrideBackground_?: string;

  static toggleDarkMode() {
    // Put dark mode in storage separate from the theme so that toggling dark
    // mode doesn't lose the chosen theme.
    localStorage.darkMode = !this.isDarkMode_();
    this.apply();
  }

  private static isDarkMode_() {
    return localStorage.darkMode === 'true';
  }

  static setOverrideBackground(overrideBackground?: string) {
    if (this.overrideBackground_ !== overrideBackground) {
      this.overrideBackground_ = overrideBackground;
      this.apply();
    }
  }

  static apply() {
    let theme;
    if (this.isDarkMode_()) {
      theme = DARK;
    } else {
      theme = ((localStorage.theme as Theme | undefined) || DEFAULT);
      if (this.overrideBackground_) {
        // Deep clone the object to avoid modifying the actual theme.
        theme = JSON.parse(JSON.stringify(theme)) as Theme;
        theme.styles[MAIN_BACKGROUND_PROPERTY] = this.overrideBackground_;
      }
    }

    let root = document.documentElement;
    for (let style of Object.entries(theme.styles)) {
      root.style.setProperty(style[0], style[1]);
    }
  }
}

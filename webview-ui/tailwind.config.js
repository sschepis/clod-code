function withOpacity(variable) {
  return ({ opacityValue }) => {
    if (opacityValue === undefined) {
      return `var(${variable})`;
    }
    return `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;
  };
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        vscode: {
          editorBg: withOpacity('--vscode-editor-background'),
          editorFg: withOpacity('--vscode-editor-foreground'),
          panelBg: withOpacity('--vscode-panel-background'),
          panelBorder: withOpacity('--vscode-panel-border'),
          widgetBg: withOpacity('--vscode-editorWidget-background'),
          widgetBorder: withOpacity('--vscode-editorWidget-border'),
          inputBg: withOpacity('--vscode-input-background'),
          inputFg: withOpacity('--vscode-input-foreground'),
          inputBorder: withOpacity('--vscode-input-border'),
          buttonBg: withOpacity('--vscode-button-background'),
          buttonFg: withOpacity('--vscode-button-foreground'),
          buttonHover: withOpacity('--vscode-button-hoverBackground'),
          focus: withOpacity('--vscode-focusBorder'),
          link: withOpacity('--vscode-textLink-foreground'),
          linkHover: withOpacity('--vscode-textLink-activeForeground'),
          desc: withOpacity('--vscode-descriptionForeground'),
          disabled: withOpacity('--vscode-disabledForeground'),
          error: withOpacity('--vscode-errorForeground'),
          warning: withOpacity('--vscode-editorWarning-foreground'),
          info: withOpacity('--vscode-editorInfo-foreground'),
          hoverBg: withOpacity('--vscode-list-hoverBackground'),
          activeBg: withOpacity('--vscode-list-activeSelectionBackground'),
        }
      }
    },
  },
  plugins: [],
};

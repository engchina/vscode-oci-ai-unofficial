/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ["./src/**/*.{jsx,tsx}"],
  },
  theme: {
    extend: {
      colors: {
        background: "var(--vscode-editor-background)",
        foreground: "var(--vscode-foreground)",
        border: {
          DEFAULT: "var(--vscode-focusBorder)",
          panel: "var(--vscode-panel-border)",
        },
        shadow: "var(--vscode-widget-shadow)",
        sidebar: {
          background: "var(--vscode-sideBar-background)",
          foreground: "var(--vscode-sideBar-foreground)",
        },
        input: {
          foreground: "var(--vscode-input-foreground)",
          background: "var(--vscode-input-background)",
          border: "var(--vscode-input-border)",
          placeholder: "var(--vscode-input-placeholderForeground)",
        },
        button: {
          background: {
            DEFAULT: "var(--vscode-button-background)",
            hover: "var(--vscode-button-hoverBackground)",
          },
          foreground: "var(--vscode-button-foreground)",
          secondary: {
            background: {
              DEFAULT: "var(--vscode-button-secondaryBackground)",
              hover: "var(--vscode-button-secondaryHoverBackground)",
            },
            foreground: "var(--vscode-button-secondaryForeground)",
          },
        },
        link: {
          DEFAULT: "var(--vscode-textLink-foreground)",
          hover: "var(--vscode-textLink-activeForeground)",
        },
        list: {
          background: {
            hover: "var(--vscode-list-hoverBackground)",
          },
        },
        badge: {
          foreground: "var(--vscode-badge-foreground)",
          background: "var(--vscode-badge-background)",
        },
        description: "var(--vscode-descriptionForeground)",
        error: "var(--vscode-errorForeground)",
        success: "var(--vscode-charts-green)",
        warning: "var(--vscode-charts-yellow)",
      },
      fontSize: {
        xl: "calc(2 * var(--vscode-font-size))",
        lg: "calc(1.5 * var(--vscode-font-size))",
        md: "calc(1.25 * var(--vscode-font-size))",
        sm: "var(--vscode-font-size)",
        xs: "calc(0.85 * var(--vscode-font-size))",
        xxs: "calc(0.75 * var(--vscode-font-size))",
      },
    },
  },
}

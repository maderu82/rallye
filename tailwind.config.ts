import type { Config } from "tailwindcss";

// Colour system from the specification (§3.4): teal/green base, coral accent,
// supporting purple for assignment cards.
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: {
          DEFAULT: "#1D9E75",
          dark: "#085041",
          light: "#E1F5EE",
        },
        coral: {
          DEFAULT: "#D85A30",
          light: "#FBE9E2",
        },
        purple: {
          DEFAULT: "#534AB7",
          light: "#EEEDFE",
        },
        ink: "#123B2E",
        paper: "#F7FBF9",
        polder: {
          grey: "#5E7268",
          line: "#D6E7DF",
        },
      },
      borderRadius: {
        card: "16px",
        soft: "10px",
      },
      boxShadow: {
        card: "0 6px 24px rgba(8,80,65,.12)",
        soft: "0 3px 12px rgba(8,80,65,.08)",
      },
      fontFamily: {
        sans: ['"Trebuchet MS"', '"Segoe UI"', "Verdana", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

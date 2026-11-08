/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Outfit"', "system-ui", "sans-serif"],
      },
      colors: {
        void: "#0e0a06", // fundo da página
        surface: "#251a0f", // cartões
        tile: "#16100a", // blocos internos
        fg: "#f4e8cc", // texto principal
        mute: "#b39a6e", // texto secundário
        edge: "#c8923a", // moldura dourada
        line: "#3b2b17", // divisórias sutis
        poke: {
          red: "#ef6b5b",
          blue: "#5cc8e8",
          yellow: "#f3c04a",
          green: "#6fd47c",
          gold: "#f3c04a",
        },
      },
      keyframes: {
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        pulseDot: { "0%,100%": { opacity: 1, transform: "scale(1)" }, "50%": { opacity: 0.5, transform: "scale(0.8)" } },
      },
      animation: {
        pulseDot: "pulseDot 1.8s ease-in-out infinite",
      },
    },
  },
};

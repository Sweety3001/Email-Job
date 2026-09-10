/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dbe6fe",
          200: "#bfd3fe",
          300: "#93b4fd",
          400: "#6090fa",
          500: "#3b6ef6",
          600: "#2553eb",
          700: "#1d40d8",
          800: "#1e36af",
          900: "#1e318a",
        },
      },
    },
  },
  plugins: [],
};

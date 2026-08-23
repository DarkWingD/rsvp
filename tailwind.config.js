/** @type {import('tailwindcss').Config} */
// Tailwind is the build tool for public/app.css. Most styling lives as explicit CSS in
// src/styles.css (theme presets via CSS variables); utilities used in templates are scanned here.
module.exports = {
  content: ['./views/**/*.ejs', './public/**/*.js'],
  theme: {
    extend: {},
  },
  plugins: [],
};

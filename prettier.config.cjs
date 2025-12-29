/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
module.exports = {
  plugins: ['prettier-plugin-tailwindcss', 'prettier-plugin-prisma'],
  trailingComma: 'es5',
  tabWidth: 2,
  semi: false,
  singleQuote: true,
  max_line_length: 100,
  jsxSingleQuote: true,
  objectWrap: 'collapse',
  bracketSameLine: true,
};

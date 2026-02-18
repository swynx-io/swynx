// src/scanner/parsers/elixir.mjs
import { parse as langParse } from '../../languages/elixir.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'elixir-regex');
export { parse };
export default { parse };

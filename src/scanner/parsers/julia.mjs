// src/scanner/parsers/julia.mjs
import { parse as langParse } from '../../languages/julia.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'julia-regex');
export { parse };
export default { parse };

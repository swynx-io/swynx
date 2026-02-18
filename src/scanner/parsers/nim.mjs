// src/scanner/parsers/nim.mjs
import { parse as langParse } from '../../languages/nim.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'nim-regex');
export { parse };
export default { parse };

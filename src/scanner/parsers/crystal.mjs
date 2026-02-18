// src/scanner/parsers/crystal.mjs
import { parse as langParse } from '../../languages/crystal.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'crystal-regex');
export { parse };
export default { parse };

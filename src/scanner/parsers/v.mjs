// src/scanner/parsers/v.mjs
import { parse as langParse } from '../../languages/v.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'v-regex');
export { parse };
export default { parse };

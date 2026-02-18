// src/scanner/parsers/vbnet.mjs
import { parse as langParse } from '../../languages/vbnet.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'vbnet-regex');
export { parse };
export default { parse };

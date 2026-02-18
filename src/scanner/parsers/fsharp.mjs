// src/scanner/parsers/fsharp.mjs
import { parse as langParse } from '../../languages/fsharp.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'fsharp-regex');
export { parse };
export default { parse };

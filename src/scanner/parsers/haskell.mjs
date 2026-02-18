// src/scanner/parsers/haskell.mjs
import { parse as langParse } from '../../languages/haskell.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'haskell-regex');
export { parse };
export default { parse };

// src/scanner/parsers/clojure.mjs
import { parse as langParse } from '../../languages/clojure.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'clojure-regex');
export { parse };
export default { parse };

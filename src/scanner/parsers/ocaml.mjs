// src/scanner/parsers/ocaml.mjs
import { parse as langParse } from '../../languages/ocaml.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'ocaml-regex');
export { parse };
export default { parse };

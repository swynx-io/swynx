// src/scanner/parsers/dart.mjs
import { parse as langParse } from '../../languages/dart.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'dart-regex');
export { parse };
export default { parse };

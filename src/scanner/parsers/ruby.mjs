// src/scanner/parsers/ruby.mjs
import { parse as langParse } from '../../languages/ruby.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'ruby-regex');
export { parse };
export default { parse };

// src/scanner/parsers/perl.mjs
import { parse as langParse } from '../../languages/perl.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'perl-regex');
export { parse };
export default { parse };

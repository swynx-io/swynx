// src/scanner/parsers/php.mjs
import { parse as langParse } from '../../languages/php.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'php-regex');
export { parse };
export default { parse };

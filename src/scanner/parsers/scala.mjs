// src/scanner/parsers/scala.mjs
import { parse as langParse } from '../../languages/scala.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'scala-regex');
export { parse };
export default { parse };

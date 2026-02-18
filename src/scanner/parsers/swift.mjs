// src/scanner/parsers/swift.mjs
import { parse as langParse } from '../../languages/swift.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'swift-regex');
export { parse };
export default { parse };

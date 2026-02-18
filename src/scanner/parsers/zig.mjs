// src/scanner/parsers/zig.mjs
import { parse as langParse } from '../../languages/zig.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'zig-regex');
export { parse };
export default { parse };

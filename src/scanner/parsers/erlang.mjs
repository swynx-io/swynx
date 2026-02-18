// src/scanner/parsers/erlang.mjs
import { parse as langParse } from '../../languages/erlang.mjs';
import { createLangParser } from './generic-lang.mjs';
const { parse } = createLangParser(langParse, 'erlang-regex');
export { parse };
export default { parse };

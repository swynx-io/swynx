import * as vetoed from './vetoed.js';
import { guardMarker } from './vetoed.js';
const api = {};
api.usedViaProperty = 'referenced by name, tracking cannot see it';
export default { api, guardMarker, vetoed };

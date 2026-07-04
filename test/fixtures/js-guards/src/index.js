import './evals.js';
import { Comp } from './component.js';
import './dispatch.js';
import { applyAll } from './dollar.js';
import { featureTested } from './feature/test.ts';
import attach from './attach.js';
console.log(Comp, applyAll({}), featureTested, attach);

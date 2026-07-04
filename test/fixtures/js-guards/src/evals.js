export const marker = 1;
function reachedViaEval() { return 'called through eval'; }
eval('reachedViaEval()');

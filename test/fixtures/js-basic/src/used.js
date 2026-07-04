export function used() { return helper(); }
export function neverImported() { return 'unused export'; }
function helper() { return 42; }
function deadLocal() {
  return 'never called';
}
const deadArrow = () => {
  return 'also dead';
};
const liveArrow = () => 'alive';
export const liveWrapper = () => liveArrow();
export function alsoUsedInternally() { return used(); }

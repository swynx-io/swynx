export class Dispatcher {
  handle(type) { return this['on' + type](); }
  onFoo() { return 'dynamically dispatched'; }
}
const table = { run: runTask };
function runTask() { return table; }

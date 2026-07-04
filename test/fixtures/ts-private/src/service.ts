export class Service {
  run(): number { return this.#liveEs() + this.liveTs(); }
  #liveEs(): number { return 1; }
  #deadEs(): string { return 'dead es private'; }
  private liveTs(): number { return 2; }
  private deadTs(): string { return 'dead ts private'; }
  private get liveGetter(): number { return 3; }
}

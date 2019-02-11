export class Aggregate {
  start: Date;
  minutesPerType: Map<string, number> = new Map();
  constructor(start: Date, minutesPerType: Map<string, number>) {
    this.start = start;
    this.minutesPerType = minutesPerType;
  }
}
import {ME_TIME_BLOCKS, TYPE_OOO} from './Constants.js';

export class Aggregate {
  start: Date;
  minutesPerType: Map<string, number> = new Map();
  constructor(start: Date, minutesPerType: Map<string, number>) {
    this.start = start;
    this.minutesPerType = minutesPerType;
  }
  meTimePercentage() {
    let total = 0;
    let notMeTime = 0;
    for (let [type, value] of this.minutesPerType) {
      if (type === TYPE_OOO)
        continue;

      total += value;
      if (!ME_TIME_BLOCKS.includes(type))
        notMeTime += value;
    }
    if (total > 0)
      return Math.ceil(100 * (total - notMeTime) / total) + '%';
    return '';
  }
}
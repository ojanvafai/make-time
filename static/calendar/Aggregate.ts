import {TYPE_OOO, TYPE_UNBOOKED_LARGE, TYPE_UNBOOKED_MEDIUM, TYPE_UNBOOKED_SMALL} from './Constants.js';

export class Aggregate {
  start: Date;
  minutesPerType: Map<string, number> = new Map();
  constructor(start: Date, minutesPerType: Map<string, number>) {
    this.start = start;
    this.minutesPerType = minutesPerType;
  }
  bookedPercentage() {
    let total = 0;
    let unbooked = 0;
    for (let [type, value] of this.minutesPerType) {
      if (type !== TYPE_OOO)
        total += value;
      switch (type) {
        case TYPE_UNBOOKED_SMALL:
        case TYPE_UNBOOKED_MEDIUM:
        case TYPE_UNBOOKED_LARGE:
          unbooked += value;
          break;
      }
    }
    if (total > 0)
      return Math.ceil(100 * (total - unbooked) / total) + '%';
    return '';
  }
}
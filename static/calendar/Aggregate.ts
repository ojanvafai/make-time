import { EventType, ME_TIME_TYPES } from './Constants.js';

export class Aggregate {
  start: Date;
  minutesPerType: Map<EventType, number> = new Map();
  constructor(start: Date, minutesPerType: Map<EventType, number>) {
    this.start = start;
    this.minutesPerType = minutesPerType;
  }
  meTimePercentage() {
    let total = 0;
    let notMeTime = 0;
    for (let [type, value] of this.minutesPerType) {
      if (type === EventType.OutOfOffice) continue;

      total += value;
      if (!ME_TIME_TYPES.includes(type)) notMeTime += value;
    }
    if (total > 0) return Math.ceil((100 * notMeTime) / total) + '%';
    return '';
  }
}

import { TYPE_UNBOOKED } from './constants.js';

export class Aggregate {
    start: Date;
    minutesPerType: Map<string, number> = new Map();
    constructor(start : Date, minutesPerType : Map<string, number>) {
      this.start = start;
      this.minutesPerType = minutesPerType;
    }

    addTotalNonMeetingTime() {
      let totalMeetingTime =
        Array.from(this.minutesPerType.values()).reduce(
          (s, c) => s + c, 0);

      if (totalMeetingTime > 8 * 60 + 0.001) {
        debugger;
        throw("Too much total meeting time");
      }

      let totalNonMeetingTime = 8*60 - totalMeetingTime;
      if (totalNonMeetingTime < 0)
        totalNonMeetingTime = 0;

      this.minutesPerType.set(TYPE_UNBOOKED, totalNonMeetingTime);
    }

    toRow() {
      return [
        this.start.toDateString()].concat(
          Array.from(this.minutesPerType.values()).map(
            x => x.toString()));
    }
  }
import {notNull} from '../Base.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {Thread, ThreadMetadataKeys} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

export class TriageModel extends ThreadListModel {
  private daysToShow_: number|null;

  constructor(private vacation_: string, private settings_: Settings) {
    super(ThreadMetadataKeys.hasLabel);
    this.daysToShow_ = settings_.get(ServerStorage.KEYS.DAYS_TO_SHOW);
  }

  private threadDays_(thread: Thread) {
    // TODO: Make this respect day boundaries instead of just doing 24 hours.
    let oneDay = 24 * 60 * 60 * 1000;
    return (Date.now() - thread.getDate().getTime()) / (oneDay);
  }

  shouldShowThread(thread: Thread) {
    if (this.vacation_ && (this.vacation_ !== thread.getLabel()))
      return false;

    if (this.daysToShow_ !== null &&
        this.threadDays_(thread) > this.daysToShow_)
      return false;

    return true;
  }

  getGroupName(thread: Thread) {
    return notNull(thread.getLabel());
  }

  protected compareThreads(a: Thread, b: Thread) {
    // Sort by queue, then by date.
    let aGroup = notNull(a.getLabel());
    let bGroup = notNull(b.getLabel());
    if (aGroup == bGroup)
      return this.compareDates(a, b);
    return this.settings_.getQueueSettings().queueNameComparator(
        aGroup, bGroup);
  }
}

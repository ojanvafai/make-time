import {notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {QueueSettings} from '../QueueSettings.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {BLOCKED_LABEL_NAME, Thread, ThreadMetadataKeys} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

export class TriageModel extends ThreadListModel {
  constructor(private settings_: Settings) {
    super();
    this.timerCountsDown = true;
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasLabel, '==', true));
  }

  private threadDays_(thread: Thread) {
    // TODO: Make this respect day boundaries instead of just doing 24 hours.
    let oneDay = 24 * 60 * 60 * 1000;
    return (Date.now() - thread.getDate().getTime()) / (oneDay);
  }

  defaultCollapsedState(groupName: string) {
    let queue = this.settings_.getQueueSettings().get(groupName).queue;
    return QueueSettings.WEEKDAYS.includes(queue) ||
        queue === QueueSettings.MONTHLY;
  }

  protected shouldShowThread(thread: Thread) {
    let vacation = this.settings_.get(ServerStorage.KEYS.VACATION);
    if (vacation && (vacation !== thread.getLabel()))
      return false;

    let daysToShow = this.settings_.get(ServerStorage.KEYS.DAYS_TO_SHOW);
    if (daysToShow !== null && this.threadDays_(thread) > daysToShow)
      return false;

    return super.shouldShowThread(thread);
  }

  getThreadRowLabel(thread: Thread) {
    return TriageModel.getThreadRowLabel(thread);
  }

  static getThreadRowLabel(thread: Thread) {
    // TODO: Show both the label and priority for blocked threads.
    if (thread.isBlocked())
      return notNull(thread.getLabel());
    return thread.getPriority() || '';
  }

  getGroupName(thread: Thread) {
    return TriageModel.getGroupName(thread);
  }

  static getGroupName(thread: Thread) {
    if (thread.isBlocked())
      return BLOCKED_LABEL_NAME;
    return notNull(thread.getLabel());
  }

  protected compareThreads(a: Thread, b: Thread) {
    return TriageModel.compareThreads(this.settings_, a, b);
  }

  static compareThreads(settings: Settings, a: Thread, b: Thread) {
    // Sort by queue, then by date.
    let aGroup = TriageModel.getGroupName(a);
    let bGroup = TriageModel.getGroupName(b);
    if (aGroup == bGroup)
      return ThreadListModel.compareDates(a, b);
    return settings.getQueueSettings().queueNameComparator(aGroup, bGroup);
  }
}

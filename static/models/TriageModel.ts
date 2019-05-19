import {notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {Calendar} from '../calendar/Calendar.js';
import {QueueSettings} from '../QueueSettings.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {BLOCKED_LABEL_NAME, Thread, ThreadMetadataKeys} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

export const RETRIAGE_LABEL_NAME = 'Retriage';

export class TriageModel extends ThreadListModel {
  constructor(private settings_: Settings) {
    super();
    this.timerCountsDown = true;
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasLabel, '==', true));
  }

  async getNoMeetingRoomEvents() {
    let offices = this.settings_.get(ServerStorage.KEYS.LOCAL_OFFICES);

    let end = new Date();
    end.setDate(end.getDate() + 28);

    let model = new Calendar(this.settings_, new Date(), end);
    await model.init();

    return model.getEventsWithoutLocalRoom(offices);
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

  getGroupName(thread: Thread) {
    return TriageModel.getGroupName(thread);
  }

  static getGroupName(thread: Thread) {
    if (thread.isBlocked())
      return BLOCKED_LABEL_NAME;
    if (thread.needsRetriage())
      return RETRIAGE_LABEL_NAME;
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

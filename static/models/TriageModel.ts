import {defined, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {Calendar} from '../calendar/Calendar.js';
import {QueueSettings} from '../QueueSettings.js';
import {SendAs} from '../SendAs.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {OVERDUE_LABEL_NAME, STUCK_LABEL_NAME, Thread, ThreadMetadataKeys} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

export const RETRIAGE_LABEL_NAME = 'Retriage';
export const NO_OFFICES = 'none';
export const IMPORTANT_NAME = 'important';

export class TriageModel extends ThreadListModel {
  private offices_?: string;
  private allowViewMessages_: boolean;

  constructor(private settings_: Settings, offices?: string) {
    super();
    this.timerCountsDown = true;

    if (offices !== NO_OFFICES) {
      this.offices_ =
          offices || this.settings_.get(ServerStorage.KEYS.LOCAL_OFFICES);
    }

    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasLabel, '==', true));

    this.allowViewMessages_ =
        this.settings_.get(ServerStorage.KEYS.ALLOW_VIEW_MESSAGES_IN_TRIAGE);
  }

  canDisallowViewMessages() {
    return true;
  }

  allowViewMessages() {
    return this.allowViewMessages_;
  }

  toggleAllowViewMessages() {
    this.allowViewMessages_ = !this.allowViewMessages_;
  }

  // Mark a bit that this thread was triaged with unread messages so it can be
  // grouped differently in todo view. Don't mark this bit for things that are
  // overdue, stuck, or retriage since those have already been fully triaged
  // once. If the unread messages were all sent by me, then consider them read
  // as well since I don't need to read messages I sent.
  needsMessageTriage(thread: Thread, sendAs: SendAs) {
    return thread.unreadNotSentByMe(sendAs) && !thread.hasDueDate() &&
        !thread.isStuck() && !thread.needsRetriage();
  }

  async getNoMeetingRoomEvents() {
    if (!this.offices_)
      return [];

    let end = new Date();
    end.setDate(end.getDate() + 28);

    let model = new Calendar(this.settings_, new Date(), end);
    await model.init();

    return model.getEventsWithoutLocalRoom(this.offices_);
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
    return super.shouldShowThread(thread);
  }

  getGroupName(thread: Thread) {
    return TriageModel.getGroupName(this.settings_, thread);
  }

  static getGroupName(settings: Settings, thread: Thread) {
    if (thread.hasDueDate())
      return OVERDUE_LABEL_NAME;

    if (thread.isStuck())
      return STUCK_LABEL_NAME;

    if (thread.needsRetriage())
      return RETRIAGE_LABEL_NAME;

    if (thread.isImportant() &&
        settings.get(ServerStorage.KEYS.PRIORITY_INBOX) ===
            Settings.SINGLE_GROUP) {
      return IMPORTANT_NAME;
    }

    return notNull(thread.getLabel());
  }

  protected compareThreads(a: Thread, b: Thread) {
    return TriageModel.compareThreads(this.settings_, a, b);
  }

  static compareThreads(settings: Settings, a: Thread, b: Thread) {
    // Sort by queue, then by date.
    let aGroup = TriageModel.getGroupName(settings, a);
    let bGroup = TriageModel.getGroupName(settings, b);

    if (aGroup == bGroup) {
      // Sort within retriage by priority first.
      if (a.needsRetriage() && a.getPriorityId() !== b.getPriorityId()) {
        let aPriority = defined(a.getPriorityId());
        let bPriority = defined(b.getPriorityId());
        return Thread.comparePriorities(aPriority, bPriority);
      }
      return ThreadListModel.compareDates(a, b);
    }

    return settings.getQueueSettings().queueNameComparator(aGroup, bGroup);
  }
}

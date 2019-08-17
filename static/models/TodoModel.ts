import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {assert, compareDates, defined, notNull, setFaviconCount} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {ServerStorage} from '../ServerStorage.js';
import {Settings} from '../Settings.js';
import {MUST_DO_PRIORITY_NAME, OVERDUE_LABEL_NAME, PINNED_PRIORITY_NAME, Priority, STUCK_LABEL_NAME, ThreadMetadataKeys, URGENT_PRIORITY_NAME} from '../Thread.js';
import {Thread} from '../Thread.js';

import {ThreadListChangedEvent, ThreadListModel} from './ThreadListModel.js';

const NEEDS_TRIAGE_SUFFIX = ' - needs triage';
const UNTRIAGED_NAME = 'Untriaged';
export const RETRIAGE_LABEL_NAME = 'Retriage';
export const NO_OFFICES = 'none';
export const IMPORTANT_NAME = 'important';

export class TodoModel extends ThreadListModel {
  private threadsData_?: firebase.firestore.DocumentData;
  private sortCount_: number;
  private isTriage_: boolean;
  private faviconCount_: number;

  constructor(settings_: Settings) {
    super(settings_);
    this.sortCount_ = 0;
    this.isTriage_ = false;
    this.faviconCount_ = 0;

    let threadsDoc = firestoreUserCollection().doc('threads');
    let metadataCollection = threadsDoc.collection('metadata');

    this.setQueries(
        metadataCollection.where(ThreadMetadataKeys.hasPriority, '==', true),
        metadataCollection.where(ThreadMetadataKeys.hasLabel, '==', true));

    threadsDoc.onSnapshot((snapshot) => {
      // Don't want snapshot updates to get called in response to local sort
      // changes since we modify the in memory data locally. The downside to
      // this is that we technically have a race if the sort order changes on a
      // different client at the same time as this one.
      if (this.sortCount_ > 0)
        this.sortCount_--;

      if (this.sortCount_)
        return;

      this.threadsData_ = snapshot.data();
      this.handleSortChanged_();
    });
  }

  postProcessThreads(threads: Thread[]) {
    let faviconCount =
        threads.reduce((accumulator: number, currentValue: Thread) => {
          let priorityId = currentValue.getPriorityId();
          let shouldCount =
              priorityId === Priority.Quick || priorityId === Priority.MustDo;
          return accumulator + (shouldCount ? 1 : 0);
        }, 0);

    // The favicon doesn't support showing 3 digets so cap at 99.
    faviconCount = Math.min(99, faviconCount);
    if (faviconCount !== this.faviconCount_) {
      this.faviconCount_ = faviconCount;
      setFaviconCount(faviconCount);
    }
  }

  setIsTriage(isTriage: boolean) {
    this.isTriage_ = isTriage;
    this.timerCountsDown = isTriage;
  }

  handleSortChanged_() {
    this.sort();
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  private shouldShowTriageThread_(thread: Thread) {
    if (!thread.needsTriage())
      return false;

    let vacation = this.settings_.get(ServerStorage.KEYS.VACATION);
    if (vacation && (vacation !== thread.getLabel()))
      return false;
    return true;
  }

  protected shouldShowThread(thread: Thread) {
    if (this.isTriage_) {
      if (!this.shouldShowTriageThread_(thread))
        return false;
    } else {
      if (thread.needsTriage()) {
        if (!this.shouldShowTriageThread_(thread))
          return false;
      } else {
        let priority = thread.getPriorityId();
        if (!priority)
          return false;

        if (this.settings_.get(ServerStorage.KEYS.VACATION) &&
            priority !== Priority.MustDo && priority !== Priority.Pin)
          return false;
      }
    }

    return super.shouldShowThread(thread);
  }

  static getTriageGroupName(settings: Settings, thread: Thread) {
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

  getGroupName(thread: Thread) {
    if (this.isTriage_)
      return TodoModel.getTriageGroupName(this.settings_, thread);

    if (thread.needsTriage())
      return UNTRIAGED_NAME;

    let priority = notNull(thread.getPriority());
    if (thread.needsMessageTriage())
      return `${priority}${NEEDS_TRIAGE_SUFFIX}`;
    return priority;
  }

  showFinalVersion() {
    return !!this.settings_.get(ServerStorage.KEYS.FINAL_VERSION);
  }

  allowedCount(groupName: string) {
    switch (groupName) {
      case PINNED_PRIORITY_NAME:
        return this.settings_.get(ServerStorage.KEYS.ALLOWED_PIN_COUNT);
      case MUST_DO_PRIORITY_NAME:
        return this.settings_.get(ServerStorage.KEYS.ALLOWED_MUST_DO_COUNT);
      case URGENT_PRIORITY_NAME:
        return this.settings_.get(ServerStorage.KEYS.ALLOWED_URGENT_COUNT);
    }
    // 0 represents no limit.
    return 0;
  }

  pinnedCount() {
    return this.getThreads()
        .filter(x => x.getPriorityId() === Priority.Pin)
        .length;
  }

  mustDoCount() {
    return this.getThreads()
        .filter(x => x.getPriorityId() === Priority.MustDo)
        .length;
  }

  urgentCount() {
    return this.getThreads()
        .filter(x => x.getPriorityId() === Priority.Urgent)
        .length;
  }

  private getSortData_(priority: number) {
    return this.threadsData_ && this.threadsData_[this.getSortKey_(priority)];
  }

  static compareTriageThreads(settings: Settings, a: Thread, b: Thread) {
    // Sort by queue, then by date.
    let aGroup = TodoModel.getTriageGroupName(settings, a);
    let bGroup = TodoModel.getTriageGroupName(settings, b);

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

  protected compareThreads(a: Thread, b: Thread) {
    if (this.isTriage_)
      return TodoModel.compareTriageThreads(this.settings_, a, b);

    if (a.needsTriage() || b.needsTriage()) {
      if (a.needsTriage() && b.needsTriage())
        return TodoModel.compareTriageThreads(this.settings_, a, b);
      return a.needsTriage() ? -1 : 1;
    }

    let aPriority = defined(a.getPriorityId());
    let bPriority = defined(b.getPriorityId());

    // Sort by priority, then by manual sort order, then by date.
    if (aPriority !== bPriority)
      return Thread.comparePriorities(aPriority, bPriority);

    if (a.needsMessageTriage() != b.needsMessageTriage())
      return a.needsMessageTriage() ? -1 : 1;

    let sortData = this.getSortData_(aPriority);
    if (sortData) {
      let aIndex = sortData.indexOf(a.id);
      let bIndex = sortData.indexOf(b.id);
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1)
          return -1;
        if (bIndex === -1)
          return 1;
        return aIndex - bIndex;
      }
    }

    return compareDates(a.getLastTriagedDate(), b.getLastTriagedDate());
  }

  private getSortKey_(priority: number) {
    return `sort-priority-${priority}`;
  }

  // TODO: only enable the sort buttons for priority group names and move this
  // into ThreadListModel.
  setSortOrder(threads: Thread[]) {
    assert(!this.isTriage_);

    let threadIds = threads.map(x => x.id);

    let update: any = {};
    let priorityId = defined(threads[0].getPriorityId());
    let sortKey = this.getSortKey_(priorityId);
    update[sortKey] = threadIds;

    // Update the in memory model right away so the UI is updated immediately.
    if (this.threadsData_) {
      this.threadsData_[sortKey] = threadIds;
      this.handleSortChanged_();
    }

    this.sortCount_++;
    let threadsDoc = firestoreUserCollection().doc('threads');
    // TODO: Should probably debounce this so that holding down the sort key
    // doesn't result in a flurry of network activity.
    threadsDoc.set(update, {merge: true})
  }
}

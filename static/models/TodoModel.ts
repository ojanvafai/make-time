import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {compareDates, defined, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {MUST_DO_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, PrioritySortOrder, ThreadMetadataKeys, URGENT_PRIORITY_NAME, BACKLOG_PRIORITY_NAME} from '../Thread.js';
import {Thread} from '../Thread.js';

import {ThreadListChangedEvent, ThreadListModel} from './ThreadListModel.js';

export class TodoModel extends ThreadListModel {
  private threadsData_?: firebase.firestore.DocumentData;
  private sortCount_: number;

  constructor(
      private vacation_: string, private allowedPinCount_: number,
      private allowedMustDoCount_: number,
      private allowedUrgentCount_: number, private finalVersion_?: boolean) {
    super(true);
    this.sortCount_ = 0;

    let threadsDoc = firestoreUserCollection().doc('threads');
    let metadataCollection = threadsDoc.collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasPriority, '==', true));

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

  handleSortChanged_() {
    this.sort();
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  protected shouldShowThread(thread: Thread) {
    let priority = thread.getPriorityId();
    if (!priority)
      return false;

    if (this.vacation_ && priority !== Priority.MustDo &&
        priority !== Priority.Pin)
      return false;

    return super.shouldShowThread(thread);
  }

  defaultCollapsedState(groupName: string) {
    return groupName === BACKLOG_PRIORITY_NAME;
  }

  getGroupName(thread: Thread) {
    if (this.finalVersion_)
      return 'Final version';
    return notNull(thread.getPriority());
  }

  hideGroupControls(groupName: string) {
    return groupName === PINNED_PRIORITY_NAME;
  }

  showFinalVersion() {
    return !!this.finalVersion_;
  }

  allowedCount(groupName: string) {
    switch (groupName) {
      case PINNED_PRIORITY_NAME:
        return this.allowedPinCount_;
      case MUST_DO_PRIORITY_NAME:
        return this.allowedMustDoCount_;
      case URGENT_PRIORITY_NAME:
        return this.allowedUrgentCount_;
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

  protected compareThreads(a: Thread, b: Thread) {
    if (this.finalVersion_)
      return compareDates(b.getLastTriagedDate(), a.getLastTriagedDate());

    let aPriority = defined(a.getPriorityId());
    let bPriority = defined(b.getPriorityId());

    // Sort by priority, then by manual sort order, then by date.
    if (aPriority !== bPriority)
      return this.comparePriorities_(aPriority, bPriority);

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

  comparePriorities_(a: Priority, b: Priority) {
    let aOrder = PrioritySortOrder.indexOf(a);
    let bOrder = PrioritySortOrder.indexOf(b);
    return aOrder - bOrder;
  }

  private getSortKey_(priority: number) {
    return `sort-priority-${priority}`;
  }

  setSortOrder(threads: Thread[]) {
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

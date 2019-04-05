import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {defined, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, Priority, PrioritySortOrder, ThreadMetadataKeys} from '../Thread.js';
import {Thread} from '../Thread.js';

import {ThreadListChangedEvent, ThreadListModel} from './ThreadListModel.js';

export class TodoModel extends ThreadListModel {
  private threadsData_?: firebase.firestore.DocumentData;

  constructor(private vacation_: string) {
    super(true);
    let threadsDoc = firestoreUserCollection().doc('threads');
    let metadataCollection = threadsDoc.collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasPriority, '==', true));

    threadsDoc.onSnapshot((snapshot) => {
      this.threadsData_ = snapshot.data();
      this.handleSortChanged_();
    });
  }

  handleSortChanged_() {
    this.sort();
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  shouldShowThread(thread: Thread) {
    let priority = thread.getPriorityId();
    if (!priority)
      return false;
    if (this.vacation_ && priority !== Priority.MustDo)
      return false;
    return super.shouldShowThread(thread);
  }

  defaultCollapsedState(groupName: string) {
    return groupName !== MUST_DO_PRIORITY_NAME &&
        groupName !== NEEDS_FILTER_PRIORITY_NAME;
  }

  getThreadRowLabel(thread: Thread) {
    return thread.getLabel() || '';
  }

  getGroupName(thread: Thread) {
    return notNull(thread.getPriority());
  }

  private getSortData_(priority: number) {
    return this.threadsData_ && this.threadsData_[this.getSortKey_(priority)];
  }

  protected compareThreads(a: Thread, b: Thread) {
    let aPriority = defined(a.getPriorityId());
    let bPriority = defined(b.getPriorityId());

    // Sort by priority, then by manual sort order, then by date.
    if (aPriority !== bPriority)
      return this.comparePriorities_(aPriority, bPriority);

    let sortData = this.getSortData_(aPriority);
    if (sortData) {
      let aIndex = sortData.indexOf(a.id);
      let bIndex = sortData.indexOf(b.id);
      if (aIndex !== undefined || bIndex !== undefined) {
        if (aIndex === undefined)
          return -1;
        if (bIndex === undefined)
          return 1;
        return aIndex - bIndex;
      }
    }

    return ThreadListModel.compareDates(a, b);
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

    let threadsDoc = firestoreUserCollection().doc('threads');
    threadsDoc.set(update, {merge: true})
  }
}

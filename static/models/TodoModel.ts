import {firebase} from '../../public/third_party/firebasejs/5.8.2/firebase-app.js';
import {defined, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, PINNED_PRIORITY_NAME, Priority, PrioritySortOrder, ThreadMetadataKeys, URGENT_PRIORITY_NAME} from '../Thread.js';
import {Thread} from '../Thread.js';

import {ThreadListChangedEvent, ThreadListModel} from './ThreadListModel.js';

export class TodoModel extends ThreadListModel {
  private threadsData_?: firebase.firestore.DocumentData;
  private sortCount_: number;
  private filter_?: string;

  constructor(private vacation_: string) {
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

  labelHref(label: string) {
    return `todo?filter=${label}`;
  }

  setFilter(filter: string) {
    this.filter_ = filter && filter.toLowerCase();
    this.dispatchEvent(new ThreadListChangedEvent());
  }

  protected shouldShowThread(thread: Thread) {
    let priority = thread.getPriorityId();
    if (!priority)
      return false;

    // Always show pinned threads even if there's a vacation
    if (priority === Priority.Pin)
      return true;

    if (this.vacation_ && priority !== Priority.MustDo)
      return false;

    let label = thread.getLabel();
    if (this.filter_ && (!label || this.filter_ !== label.toLowerCase()))
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

  showTopThreads(groupName: string) {
    return groupName === MUST_DO_PRIORITY_NAME ||
        groupName === URGENT_PRIORITY_NAME;
  }

  hideGroupControls(groupName: string) {
    return groupName === PINNED_PRIORITY_NAME;
  }

  pinnedCount() {
    return this.getThreads()
        .filter(x => x.getPriorityId() === Priority.Pin)
        .length;
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
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1)
          return -1;
        if (bIndex === -1)
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

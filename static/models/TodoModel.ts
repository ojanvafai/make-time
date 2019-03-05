import {defined, notNull} from '../Base.js';
import {firestoreUserCollection} from '../BaseMain.js';
import {MUST_DO_PRIORITY_NAME, NEEDS_FILTER_PRIORITY_NAME, Priority, PrioritySortOrder, ThreadMetadataKeys} from '../Thread.js';
import {Thread} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

export class TodoModel extends ThreadListModel {
  constructor(private vacation_: string) {
    super(true);
    let metadataCollection =
        firestoreUserCollection().doc('threads').collection('metadata');
    this.setQuery(
        metadataCollection.where(ThreadMetadataKeys.hasPriority, '==', true));
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

  protected compareThreads(a: Thread, b: Thread) {
    let aPriority = defined(a.getPriorityId());
    let bPriority = defined(b.getPriorityId());

    // Sort by priority, then by date.
    if (aPriority == bPriority)
      return this.compareDates(a, b);
    return this.comparePriorities_(aPriority, bPriority);
  }

  comparePriorities_(a: Priority, b: Priority) {
    let aOrder = PrioritySortOrder.indexOf(a);
    let bOrder = PrioritySortOrder.indexOf(b);
    return aOrder - bOrder;
  }
}

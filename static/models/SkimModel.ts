import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';

import {TriageModel} from './TriageModel.js';

export class SkimModel extends TriageModel {
  private allowViewMessages_: boolean;

  constructor(settings: Settings) {
    super(settings);
    this.allowViewMessages_ = false;
  }

  protected shouldShowThread(thread: Thread) {
    if (thread.skimmed())
      return false;
    return super.shouldShowThread(thread);
  }

  allowViewMessages() {
    return this.allowViewMessages_;
  }

  toggleAllowViewMessages() {
    this.allowViewMessages_ = !this.allowViewMessages_;
  }
}

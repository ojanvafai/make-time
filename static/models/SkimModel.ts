import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';

import {TriageModel} from './TriageModel.js';

export class SkimModel extends TriageModel {
  constructor(settings: Settings) {
    super(settings);
  }

  protected shouldShowThread(thread: Thread) {
    if (thread.skimmed())
      return false;
    return super.shouldShowThread(thread);
  }
}

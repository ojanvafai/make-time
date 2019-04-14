import {Model} from './Model.js';

export class TrackingModel extends Model {
  constructor() {
    super();
  }

  async update() {}

  async loadFromDisk() {
    // return await IDBKeyVal.getDefault().get(AUTO_SAVE_KEY);
  }
}

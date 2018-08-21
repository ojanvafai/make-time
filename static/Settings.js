class Settings {
  async fetch() {
    if (!localStorage.spreadsheetId)
      await this.showSetupDialog_();

    this.spreadsheetId = localStorage.spreadsheetId;
    this.storage_ = new ServerStorage(this.spreadsheetId);
    await this.storage_.fetch();

    this.queuedLabelMap = await fetch2ColumnSheet(this.spreadsheetId, QUEUED_LABELS_SHEET_NAME, 1);
  }

  async showSetupDialog_() {
    return new Promise((resolve, reject) => {
      let setId = () => {
        let url = document.getElementById('settings-url').value;
        // Spreadsheets URLS are of the form
        // https://docs.google.com/spreadsheets[POSSIBLE_STUFF_HERE]/d/[ID_HERE]/[POSSIBLE_STUFF_HERE]
        let id = url.split('/d/')[1].split('/')[0];
        localStorage.spreadsheetId = id;
        resolve();
        dialog.close();
      }

      let contents = document.createElement('div');
      contents.innerHTML = `make-time is a side project and I don't want to deal with storing sensitive data on a server. So all data is stored in a spreadsheet of your making or in your browser's local storage.

  To create a settings spreadsheet:
    1. Go to <a href="//goto.google.com/make-time-settings" target="blank">go/make-time-settings</a>
    2. Create a copy of it
    3. Paste in the URL of the new spreadsheet (the copy!) below.

  You'll need to do step 3 anytime you're using make-time on a new computer since the spreadsheet URL is stored locally in your browser.

  <div style="display: flex"><b>Spreadsheet URL: </b> <input id="settings-url" style="flex: 1"></div>
  <button style="float:right">Submit</button>`;

      let dialog = showDialog(contents);
      dialog.style.whiteSpace = 'pre-wrap';
      dialog.querySelector('button').onclick = setId;
      dialog.oncancel = () => {
        alert(`Make-time requires a settings spreadsheet to function.`);
        window.location.reload();
      };
    });
  }

  has(setting) {
    let value = this.storage_.get(setting);
    return value !== undefined;
  }

  get(setting) {
    let value = this.storage_.get(setting);
    if (value === undefined)
      return this.defaultValue_(setting);
    return value;
  }

  async writeUpdates(updates) {
    await this.storage_.writeUpdates(updates);
  }

  defaultValue_(setting) {
    for (let field of Settings.fields) {
      if (field.key == setting)
        return field.default;
    }
    throw `No such setting: ${setting}`;
  }
}

Settings.fields = [
  {
    key: ServerStorage.KEYS.VACATION_SUBJECT,
    name: 'Vacation subject',
    description: `String to search subject lines to search for to show. When on vacation, you can restrict make-time to only process and show urgent messages so you can be on vacation with the peace of mind that nothing urgent has come up without actually getting embroiled in non-urgent vacation activities.`,
  },
  {
    key: ServerStorage.KEYS.TIMER_DURATION,
    name: 'Triage countdown timer',
    description: `Number of seconds to triage a single thread. When the timeout is hit, you are forced to take a triage action.`,
    default: 20,
    type: 'number',
  },
  {
    key: ServerStorage.KEYS.ALLOWED_REPLY_LENGTH,
    name: 'Allowed quick reply length',
    description: `Allowed length of quick replies. Longer messages will refuse to send.`,
    default: 280,
    type: 'number',
  },
];

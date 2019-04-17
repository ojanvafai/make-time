import {getActionKey, getActions} from '../Actions.js';

import {HelpDialog} from './HelpDialog.js';

function humanReadableKeyName(key: string) {
  switch (key) {
    case ' ':
      return '<space>';
    case 'ArrowDown':
      return '⬇';
    case 'ArrowUp':
      return '⬆';
    case 'Escape':
      return '<esc>';
    case 'Enter':
      return '<enter>';
    default:
      return key;
  }
}


export class KeyboardShortcutsDialog {
  constructor() {
    let table = document.createElement('table');

    let actions = getActions();
    let isFirst = true;
    for (let entry of actions) {
      let viewName = entry[0];
      let actions = entry[1];

      let headerRow = document.createElement('tr');
      if (!isFirst) {
        headerRow.style.cssText = `
          height: 40px;
          vertical-align: bottom;
        `;
      }
      isFirst = false;
      table.append(headerRow);

      headerRow.append(document.createElement('td'));

      let headerCell = document.createElement('td');
      headerCell.style.cssText = `
        font-weight: bold;
      `;
      headerCell.append(viewName);
      headerRow.append(headerCell);

      // TODO: These should probably be presented in a deliberate order and
      // grouped, e.g. navigation actions adjacent to each other.
      for (let action of actions) {
        let row = document.createElement('tr');
        table.append(row);

        let key = humanReadableKeyName(getActionKey(action));

        let shortcut = document.createElement('td');
        shortcut.style.cssText = `
          font-weight: bold;
          color: green;
          text-align: right;
          padding-right: 4px;
        `;
        shortcut.append(key);

        if (action.secondaryKey)
          shortcut.append(` or ${humanReadableKeyName(action.secondaryKey)}`);

        row.append(shortcut);

        let name = document.createElement('td');
        name.style.cssText = `
          white-space: nowrap;
          padding-right: 10px;
        `;
        name.append(action.name);
        row.append(name);

        let description = document.createElement('td');
        description.append(action.description);
        row.append(description);
      }
    }

    let container = document.createElement('div');
    container.append('Keyboard Shortcuts', document.createElement('hr'), table);
    new HelpDialog(container);
  }
}

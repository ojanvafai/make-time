import {Action, getActions, getPrimaryShortcut, shortcutString} from '../Actions.js';

import {HelpDialog} from './HelpDialog.js';

export class KeyboardShortcutsDialog {
  constructor() {
    let table = document.createElement('table');
    table.style.borderCollapse = 'collapse';

    let actions = getActions();
    for (let entry of actions) {
      let viewName = entry[0];

      let headerRow = document.createElement('tr');
      headerRow.style.cssText = `
        height: 60px;
      `;
      table.append(headerRow);

      headerRow.append(document.createElement('td'));

      let headerCell = document.createElement('td');
      headerCell.style.cssText = `
        font-weight: bold;
      `;
      headerCell.append(viewName);
      headerRow.append(headerCell);
      let actions = entry[1];
      // TODO: These should probably be presented in a deliberate order and
      // grouped, e.g. navigation actions adjacent to each other.
      let flatActions = actions.flat();
      for (let action of flatActions) {
        this.appendActions_(action, table);
      }
    }

    let title = document.createElement('div');
    title.style.cssText = `
      font-weight: bold;
      border-bottom: 1px solid var(--border-and-hover-color);
    `;
    title.append('Keyboard Shortcuts');

    let container = document.createElement('div');
    container.append(title, table);
    new HelpDialog(container);
  }

  private appendActions_(action: Action, container: HTMLTableElement) {
    let row = document.createElement('tr');
    row.style.borderTop = '1px dotted var(--border-and-hover-color)';
    container.append(row);

    let key = shortcutString(getPrimaryShortcut(action));

    let shortcut = document.createElement('td');
    shortcut.style.cssText = `
        font-weight: bold;
        color: green;
        text-align: right;
        padding-right: 4px;
        white-space:pre;
      `;
    shortcut.append(key);

    if (action.secondaryKey)
      shortcut.append(`\nOR\n${shortcutString(action.secondaryKey)}`);

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

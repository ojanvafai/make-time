import { Action, getActions, shortcutString } from '../Actions.js';

import { HelpDialog } from './HelpDialog.js';

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
      let flatActions = actions.flat(2);
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

    let key = shortcutString(action.key);

    let shortcut = document.createElement('td');
    shortcut.style.cssText = `
      font-weight: bold;
      color: green;
      text-align: right;
      padding-right: 10px;
      white-space:pre;
    `;
    shortcut.append(key);

    if (action.secondaryKey) shortcut.append(`\nOR\n${shortcutString(action.secondaryKey)}`);

    row.append(shortcut);

    let nameContainer = document.createElement('td');
    nameContainer.style.cssText = `
      white-space: nowrap;
      padding-right: 10px;
    `;
    let name = action.name;
    if (typeof name !== 'string') {
      name = name.cloneNode(true) as HTMLElement | SVGElement;
      // This is a gross hack to make the svg icons not be enormous.
      // Is there a better way to get SVG to size to the line-height?
      name.style.height = '1.1em';
    }
    nameContainer.append(name);
    row.append(nameContainer);

    let description = document.createElement('td');
    description.append(action.description);
    row.append(description);
  }
}

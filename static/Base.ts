export let USER_ID = 'me';

export function getCurrentWeekNumber() {
  let today = new Date();
  var januaryFirst = new Date(today.getFullYear(), 0, 1);
  var msInDay = 86400000;
  // @ts-ignore TODO: Make subtracting date types from each other actually work.
  return Math.ceil((((today - januaryFirst) / msInDay) + januaryFirst.getDay()) / 7);
}

export function showDialog(contents: HTMLElement) {
  let dialog = document.createElement('dialog');
  // Subtract out the top/bottom, padding and border from the max-height.
  dialog.style.cssText = `
    top: 15px;
    padding: 8px;
    border: 3px solid grey;
    max-height: calc(100vh - 30px - 16px - 6px);
    max-width: 800px;
    position: fixed;
    display: flex;
    overscroll-behavior: none;
  `;
  dialog.addEventListener('close', () => dialog.remove());

  dialog.append(contents);
  document.body.append(dialog);

  dialog.showModal();
  return dialog;
}
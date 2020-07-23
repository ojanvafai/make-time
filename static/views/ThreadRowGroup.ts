import {assert, collapseArrow, expandArrow} from '../Base.js';
import {ALL, NONE, SelectBox, SelectChangedEvent, SOME} from '../SelectBox.js';

import {AfterFocusRowEvent, ThreadRow} from './ThreadRow.js';
import {ThreadRowGroupBase} from './ThreadRowGroupBase.js';

// TODO: Find a better home for this. In theory it should be in ThreadRow.ts,
// but that creates a circular reference loading ThreadRowGroup.
export class SelectRowEvent extends Event {
  static NAME = 'select-row';
  constructor(public selected: boolean, public shiftKey: boolean) {
    super(SelectRowEvent.NAME, {bubbles: true});
  }
}

export enum ThreadRowGroupRenderMode {
  Default,
  ShowOnlyHighlightedRows,
  CardStyle,
  UnfilteredStyle,
}

export class ThreadRowGroup extends ThreadRowGroupBase {
  private rowContainer_: HTMLElement;
  private placeholder_: HTMLElement;
  private lastRowHeight_?: number;
  private wasCollapsed_?: boolean;
  private inViewport_: boolean;
  private wasInViewport_: boolean;
  private rows_?: ThreadRow[];
  private selectBox_: SelectBox;
  private slider_?: HTMLInputElement;
  private tickmarks_?: HTMLDataListElement;
  private groupNameContainer_?: HTMLElement;
  private rowCountDisplay_?: Text;
  private expander_?: HTMLElement;
  private collapsed_: boolean;
  private manuallyCollapsed_: boolean;
  private allowCollapsing_: boolean;

  constructor(
      name: string, private allowedCount_: number,
      private mode_: ThreadRowGroupRenderMode) {
    super(name);

    this.allowCollapsing_ = mode_ !== ThreadRowGroupRenderMode.CardStyle &&
        mode_ !== ThreadRowGroupRenderMode.UnfilteredStyle;
    this.collapsed_ = this.allowCollapsing_;
    this.manuallyCollapsed_ = false;
    this.wasInViewport_ = true;
    this.inViewport_ = false;

    this.selectBox_ = new SelectBox();
    this.selectBox_.addEventListener(SelectChangedEvent.NAME, () => {
      this.selectRows(this.selectBox_!.selected() === ALL);
    });
    this.addEventListener(SelectRowEvent.NAME, () => this.updateSelectBox_());

    this.rowContainer_ = document.createElement('div');
    if (this.allowCollapsing_) {
      this.appendHeader_();
    }
    this.placeholder_ = document.createElement('div');
    this.placeholder_.style.backgroundColor = 'var(--nested-background-color)';
    this.append(this.rowContainer_, this.placeholder_);

    if (mode_ === ThreadRowGroupRenderMode.ShowOnlyHighlightedRows) {
      this.tickmarks_ = document.createElement('datalist');
      this.slider_ = document.createElement('input');
      this.append(this.slider_, this.tickmarks_);
      this.setupRangeSlider_(this.slider_, this.tickmarks_);
    }
  }

  private setupRangeSlider_(
      slider: HTMLInputElement, tickmarks: HTMLDataListElement) {
    const tickmarksId = `${this.name}-tickmarks`;
    tickmarks.id = tickmarksId;

    slider.type = 'range';
    slider.setAttribute('list', tickmarksId);
    slider.style.cssText = `
      width: 100%;
    `;
    slider.addEventListener('input', () => {
      const index = Number(this.slider_!.value);
      assert(this.rows_)[index].setFocus(true, true);
    });
    slider.addEventListener('keydown', (e) => {
      // When you click on the slider in Chrome it gets focus and then eats
      // all key presses, not just the ones it consumes.
      this.dispatchEvent(new KeyboardEvent(e.type, e));
    });

    this.addEventListener(
        AfterFocusRowEvent.NAME, () => this.updateSliderPositionFromFocus_());
  }

  private appendHeader_() {
    this.groupNameContainer_ = this.createGroupNameContainer();
    this.groupNameContainer_.addEventListener(
        'click', () => this.setManuallyCollapsed_(!this.collapsed_));
    this.expander_ = document.createElement('div');
    this.expander_.style.cssText = `
      color: var(--dim-text-color);
      margin-top: 2px;
      font-weight: bold;
      font-size: 12px;
    `;
    this.rowCountDisplay_ = new Text();
    this.groupNameContainer_.append(
        this.expander_, this.name, this.rowCountDisplay_);

    let header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: stretch;
    `;
    header.append(this.selectBox_, this.groupNameContainer_);
    this.append(header);
  }

  setInViewport(inViewport: boolean) {
    this.inViewport_ = inViewport;

    if (this.collapsed_)
      return;

    this.showRows_();

    let rows = Array.from(this.rowContainer_.children) as ThreadRow[];
    for (let row of rows) {
      row.setInViewport(inViewport);
    }
  }

  private showRows_() {
    this.rowContainer_.style.display = this.inViewport_ ? '' : 'none';
    this.placeholder_.style.display = this.inViewport_ ? 'none' : '';
  }

  getRows() {
    return Array.from(this.rowContainer_.childNodes) as ThreadRow[];
  }

  getFirstRow() {
    return this.rowContainer_.firstChild as ThreadRow | null;
  }

  private updateRowCount_() {
    if (!this.groupNameContainer_ || !this.rowCountDisplay_)
      return;

    // -1 is a magic value for allowed count to hide the count of threads
    // entirely.
    if (this.allowedCount_ === -1)
      return;

    let count = this.getRows().length;
    let overLimit = this.allowedCount_ && count > this.allowedCount_;
    this.groupNameContainer_.style.color = overLimit ? 'red' : '';

    let text;
    if (overLimit)
      text = ` (${count}/${this.allowedCount_})`;
    else
      text = ` (${count})`;
    this.rowCountDisplay_.textContent = text;
  }

  private updateSelectBox_() {
    // This needs to look at all the row groups
    let hasChecked = false;
    let hasUnchecked = false;
    let rows = this.getRows();
    for (let row of rows) {
      if (hasChecked && hasUnchecked)
        break;
      if (row.checked) {
        hasChecked = true;
      } else {
        hasUnchecked = true;
      }
    }

    let select;
    if (hasChecked && hasUnchecked) {
      select = SOME;
    } else if (hasUnchecked) {
      select = NONE;
    } else {
      select = ALL;
    }

    this.selectBox_.select(select);
  }

  private setManuallyCollapsed_(shouldCollapse: boolean) {
    this.manuallyCollapsed_ = true;
    this.setCollapsed(shouldCollapse, true);
  }

  setCollapsed(collapsed: boolean, force?: boolean) {
    if (!this.allowCollapsing_ || !force && this.manuallyCollapsed_)
      return;

    // Performance optimization to avoid rendering when nothing has changed.
    if (this.collapsed_ === collapsed)
      return;

    if (collapsed) {
      this.selectRows(false);
    } else {
      this.ensureHasFocusedRow_();
    }

    this.collapsed_ = collapsed;
    this.render();
  }

  private rowsChanged_(rows: ThreadRow[]) {
    if (rows.length !== this.rowContainer_.childElementCount)
      return true;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] !== this.rowContainer_.children[i])
        return true;
    }
    return false;
  }

  setRows(rows: ThreadRow[]) {
    this.rows_ = rows;
    return this.render();
  }

  private getFocusedIndex_() {
    const rows = assert(this.rows_);
    return rows.findIndex(row => row.focused);
  }

  private updateSliderPositionFromFocus_() {
    const focusedIndex = this.getFocusedIndex_();
    if (focusedIndex !== -1)
      assert(this.slider_).value = String(focusedIndex);
  }

  private ensureHasFocusedRow_() {
    const focusedIndex = this.getFocusedIndex_();
    if (focusedIndex === -1) {
      assert(this.rows_)[0].setFocus(true, true);
    }
  }

  private updateTickmarks_() {
    const tickmarks = assert(this.tickmarks_);
    tickmarks.innerHTML = '';
    for (let i = 0; i < assert(this.rows_).length; i++) {
      const option = document.createElement('option');
      option.value = String(i);
      tickmarks.append(option);
    }
  }

  render() {
    if (!this.rows_)
      return [];

    // Minimize DOM modifications to only the cases where something has changed.
    let rowListChanged = this.rowsChanged_(this.rows_);
    if (rowListChanged || this.lastRowHeight_ !== ThreadRow.lastHeight()) {
      this.lastRowHeight_ = ThreadRow.lastHeight();
      this.placeholder_.style.height = this.collapsed_ ?
          '0' :
          `${this.rows_.length * this.lastRowHeight_}px`;
    }

    let collapseChanged = this.wasCollapsed_ !== this.collapsed_;
    // Performance optimization to avoid doing a bunch of DOM if the count and
    // sort order of rows didn't change.
    if (!rowListChanged && !collapseChanged)
      return [];

    // We early return in setInViewport, so we need to call it again when
    // collapse state changes.
    if (collapseChanged && this.wasInViewport_ !== this.inViewport_) {
      this.setInViewport(this.inViewport_);
      this.wasInViewport_ = this.inViewport_;
    }

    const effectiveMode =
        this.mode_ === ThreadRowGroupRenderMode.ShowOnlyHighlightedRows &&
            this.rows_.length <= 2 ?
        ThreadRowGroupRenderMode.Default :
        this.mode_;
    this.wasCollapsed_ = this.collapsed_;
    if (this.expander_) {
      this.expander_.textContent = '';
      this.expander_.append(this.collapsed_ ? expandArrow() : collapseArrow());
    }
    if (this.collapsed_) {
      this.rowContainer_.style.display = 'none';
      this.placeholder_.style.display = 'none';
      if (this.slider_) {
        this.slider_.style.display = 'none';
      }
    } else {
      if (this.slider_) {
        const rowCount = this.rows_.length;
        if (effectiveMode ===
            ThreadRowGroupRenderMode.ShowOnlyHighlightedRows) {
          this.updateTickmarks_();
          this.slider_.style.display = '';
          this.slider_.setAttribute('max', String(rowCount - 1));
          this.updateSliderPositionFromFocus_();
        } else {
          this.slider_.style.display = 'none';
        }
      }
      this.showRows_();
    }

    let removed = [];
    // Remove rows that no longer exist.
    for (let row of Array.from(this.rowContainer_.children) as ThreadRow[]) {
      if (!this.rows_.includes(row)) {
        row.remove();
        removed.push(row);
      }
    }

    let previousRow;
    // Ensure the order of rows match the new order, but also try to
    // minimize moving things around in the DOM to minimize style recalc.
    for (let row of this.rows_) {
      if (previousRow ? row.previousSibling !== previousRow :
                        row !== this.rowContainer_.firstChild) {
        if (previousRow)
          previousRow.after(row);
        else
          this.rowContainer_.prepend(row);
      }
      row.setInViewport(this.inViewport_);
      row.setRenderMode(effectiveMode);
      previousRow = row;
    }
    this.updateRowCount_();
    return removed;
  }

  hasSelectedRows() {
    const selected = this.selectBox_.selected();
    return [ALL, SOME].includes(selected);
  }

  selectRows(select: boolean) {
    if (select) {
      this.setManuallyCollapsed_(false);
    }
    this.selectBox_.select(select ? ALL : NONE);
    let rows = this.getRows();
    for (let child of rows) {
      if (child.checked !== select)
        child.setChecked(select);
      if (!select)
        child.clearFocusImpliesSelected();
    }

    if (select) {
      let lastRow = rows[rows.length - 1];
      lastRow.setFocus(true, true);
    }
  }
}
window.customElements.define('mt-thread-row-group', ThreadRowGroup);

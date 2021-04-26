import { Action, registerActions } from '../Actions.js';
import { Aggregate } from '../calendar/Aggregate.js';
import { Calendar, EventListChangeEvent } from '../calendar/Calendar.js';
import { Charter } from '../calendar/Charter.js';
import { Dialog } from '../Dialog.js';

import { View } from './View.js';

let COLORIZE_ACTION: Action = {
  name: 'Colorize Events',
  key: 'c',
  description: 'Set the colors of events in your calendar to match the ones shown here.',
};
let ACTIONS = [COLORIZE_ACTION];
registerActions('Calendar', ACTIONS);

export class CalendarView extends View {
  private loading_: HTMLElement;
  private dayPlot_: HTMLElement;
  private weekPlot_: HTMLElement;
  private plotlyLoadPromise_: Promise<void>;
  private boundRender_: () => void;

  constructor(private model_: Calendar) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.setActions(ACTIONS);

    this.loading_ = document.createElement('div');
    this.loading_.append('Loading...this can take a couple minutes...');
    this.append(this.loading_);

    this.dayPlot_ = document.createElement('div');
    this.dayPlot_.id = 'day_plot';
    this.append('Day summaries:', this.dayPlot_);

    this.weekPlot_ = document.createElement('div');
    this.weekPlot_.id = 'week_plot';
    this.append('Week summaries:', this.weekPlot_);

    this.plotlyLoadPromise_ = new Promise((resolve) => {
      let plotlyScript = document.createElement('script');
      plotlyScript.addEventListener('load', () => resolve());
      plotlyScript.src = 'https://cdn.plot.ly/plotly-1.4.1.min.js';
      this.append(plotlyScript);
    });

    this.boundRender_ = () => this.render_();
  }

  async init() {
    await this.model_.init();
    await this.render_();
  }

  connectedCallback() {
    this.model_.addEventListener(EventListChangeEvent.NAME, this.boundRender_);
  }

  disconnectedCallback() {
    this.model_.removeEventListener(EventListChangeEvent.NAME, this.boundRender_);
  }

  private async render_() {
    const charter = new Charter(this.model_.ruleMetadata());
    const days = await this.model_.getDayAggregates();

    // Ensure plotly has loaded before trying to chart anything.
    await this.plotlyLoadPromise_;
    this.loading_.remove();

    await this.chartData_(charter, this.dayPlot_, days, 14);

    // Do this async so we show the day chart ASAP.
    setTimeout(async () => {
      const weeks = await this.model_.getWeekAggregates();
      await this.chartData_(charter, this.weekPlot_, weeks, 90);
    });
  }

  private async chartData_(charter: Charter, container: Node, data: Aggregate[], buffer: number) {
    let startDate = new Date();
    startDate.setDate(startDate.getDate() - buffer);
    let endDate = new Date();
    endDate.setDate(endDate.getDate() + buffer);
    await charter.chartData(data, container, [startDate.getTime(), endDate.getTime()]);
  }

  async takeAction(action: Action) {
    if (action === COLORIZE_ACTION) {
      if (!confirm('This sets colors to all events on your calendar. Proceed?')) return false;
      // Colorize is not safe to be called multiple times, so remove the button
      // after the first call, forcing the user to reload to call it again.
      this.setActions([]);
      let dialog = new Dialog('Colorizing...this takes a while.', []);
      await this.model_.colorizeEvents();
      dialog.remove();
      return true;
    }

    throw `Invalid action: ${JSON.stringify(action)}`;
  }
}

window.customElements.define('mt-calendar-view', CalendarView);

import {Calendar} from '../calendar/Calendar.js';
import {Charter} from '../calendar/Charter.js';

import {View} from './View.js'
import { Action } from '../Actions.js';

let COLORIZE_ACTION: Action = {
  name: 'Colorize Events',
  description:
      'Set the colors of events in your calendar to match the ones shown here.',
};

export class CalendarView extends View {
  private dayPlot: HTMLElement;
  private weekPlot: HTMLElement;

  constructor(private model_: Calendar) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.setActions([COLORIZE_ACTION]);

    this.dayPlot = document.createElement('div');
    this.dayPlot.id = 'day_plot';
    this.append(this.dayPlot);

    this.weekPlot = document.createElement('div');
    this.weekPlot.id = 'week_plot';
    this.append(this.weekPlot);

    let plotlyScript = document.createElement('script');
    plotlyScript.src = 'https://cdn.plot.ly/plotly-1.4.1.min.js';
    this.append(plotlyScript);
  }

  async init() {
    await this.model_.init();
    const charter = new Charter();
    const days = await this.model_.getDayAggregates();
    const weeks = await this.model_.getWeekAggregates();
    charter.chartData(days, this.dayPlot.id);
    charter.chartData(weeks, this.weekPlot.id);
  }

  async takeAction(action: Action) {
    if (action == COLORIZE_ACTION) {
      this.model_.colorizeEvents();
      return;
    }

    throw `Invalid action: ${JSON.stringify(action)}`;
  }
}

window.customElements.define('mt-calendar-view', CalendarView);

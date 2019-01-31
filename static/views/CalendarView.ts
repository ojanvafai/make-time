import {Action, registerActions} from '../Actions.js';
import {Calendar} from '../calendar/Calendar.js';
import {Charter} from '../calendar/Charter.js';

import {View} from './View.js'

let COLORIZE_ACTION: Action = {
  name: 'Colorize Events',
  description:
      'Set the colors of events in your calendar to match the ones shown here.',
};
let ACTIONS = [COLORIZE_ACTION];
registerActions('Calendar', ACTIONS);

export class CalendarView extends View {
  private dayPlot: HTMLElement;
  private weekPlot: HTMLElement;

  constructor(private model_: Calendar) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.setActions(ACTIONS);

    this.dayPlot = document.createElement('div');
    this.dayPlot.id = 'day_plot';
    this.append('Day summaries:', this.dayPlot);

    this.weekPlot = document.createElement('div');
    this.weekPlot.id = 'week_plot';
    this.append('Week summaries:', this.weekPlot);

    let plotlyScript = document.createElement('script');
    plotlyScript.src = 'https://cdn.plot.ly/plotly-1.4.1.min.js';
    this.append(plotlyScript);
  }

  async init() {
    await this.model_.init();
    const charter = new Charter();
    const days = await this.model_.getDayAggregates();
    const weeks = await this.model_.getWeekAggregates();

    let startDate = new Date();
    startDate.setDate(startDate.getDate() - 14);
    let endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);
    charter.chartData(
        days, this.dayPlot.id, [startDate.getTime(), endDate.getTime()]);

    let weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() - 90);
    let weekEndDate = new Date();
    weekEndDate.setDate(weekEndDate.getDate() + 90);
    charter.chartData(
        weeks, this.weekPlot.id,
        [weekStartDate.getTime(), weekEndDate.getTime()]);
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

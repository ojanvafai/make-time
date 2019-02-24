import {Action, registerActions} from '../Actions.js';
import {Aggregate} from '../calendar/Aggregate.js';
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
    await this.chartData_(charter, this.dayPlot.id, days, 14)

    // Do this async so we show the day chart ASAP.
    setTimeout(async () => {
      const weeks = await this.model_.getWeekAggregates();
      await this.chartData_(charter, this.weekPlot.id, weeks, 90);
    });
  }

  private async chartData_(
      charter: Charter, plotId: string, data: Aggregate[], buffer: number) {
    let startDate = new Date();
    startDate.setDate(startDate.getDate() - buffer);
    let endDate = new Date();
    endDate.setDate(endDate.getDate() + buffer);
    await charter.chartData(
        data, plotId, [startDate.getTime(), endDate.getTime()]);
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

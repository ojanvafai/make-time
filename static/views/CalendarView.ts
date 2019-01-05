import {Calendar} from '../calendar/Calendar.js';
import {Charter} from '../calendar/Charter.js';

import {View} from './View.js'

export class CalendarView extends View {
  private dayPlot: HTMLElement;
  private weekPlot: HTMLElement;
  private colorizeButton: HTMLElement;

  constructor(private model_: Calendar) {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.colorizeButton = document.createElement('button');
    this.colorizeButton.innerText = 'Colorize Events';
    this.colorizeButton.addEventListener('click', () => {
      this.model_.colorizeEvents();
    });
    this.setFooter(this.colorizeButton);

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

  getModel() {
    return this.model_;
  }
}

window.customElements.define('mt-calendar-view', CalendarView);

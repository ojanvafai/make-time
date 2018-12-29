import {Calendar} from '../calendar/calendar.js';
import {Charter} from '../calendar/charter.js';
import {Model} from '../models/Model.js';

import {View} from './View.js'

class CalendarModel extends Model {
  async loadFromDisk() {
    return new Promise((resolve) => resolve());
  }
  async update(): Promise<void> {
    return new Promise(resolve => resolve());
  }
}

export class CalendarView extends View {
  private dayPlot: HTMLElement;
  private weekPlot: HTMLElement;
  private colorizeButton: HTMLElement;
  private calendar: Calendar = new Calendar();

  private model: Model = new CalendarModel(title => {
    console.log('TITLE UPDATE TO ' + title);
  });

  async init() {
    this.calendar.init();
    const charter = new Charter();
    await charter.init();
    const days = await this.calendar.getDayAggregates();
    const weeks = await this.calendar.getWeekAggregates();
    charter.chartData(days, this.dayPlot.id);
    charter.chartData(weeks, this.weekPlot.id);
  }

  constructor() {
    super();

    this.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    this.colorizeButton = document.createElement('button');
    this.colorizeButton.innerText = 'Colorize Events';
    this.colorizeButton.addEventListener('click', () => {
      this.calendar.colorizeEvents();
    });
    this.append(this.colorizeButton);

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

  setFooter_(dom: HTMLElement) {
    let footer = <HTMLElement>document.getElementById('footer');
    footer.textContent = 'Dummy Footer';
    footer.append(dom);
  }

  async goBack() {}

  async update() {
    console.log('UPDATE');
  }

  getModel() {
    return this.model;
  }

  tearDown() {}

  async renderFromDisk(): Promise<void> {
    return new Promise(resolve => resolve());
  }

  async dispatchShortcut(e: KeyboardEvent) {
    console.log(e)
  };
}

window.customElements.define('mt-calendar-view', CalendarView);

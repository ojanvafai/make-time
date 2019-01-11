import {AsyncOnce} from '../AsyncOnce.js';

import {Aggregate} from './Aggregate.js'
import {CALENDAR_ID, TYPES} from './Constants.js'

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

export class Charter {
  private colors: AsyncOnce<any>;

  constructor() {
    this.colors = new AsyncOnce<any>(async () => {
      //@ts-ignore
      let response = await gapi.client.calendar.colors.get({
        calendarId: CALENDAR_ID,
      });
      return response.result.event;
    });
  }

  async chartData(aggregates: Aggregate[], divId: string) {
    let colors = await this.colors.do();
    const dates = aggregates.map(day => day.start);

    interface PlotlySeries {
      x: Date[], y: number[], name: string, type: string, marker: {
        color: string,
      }
    }
    const data: PlotlySeries[] = [];

    for (let type of TYPES.keys()) {
      const color = hexToRGB(colors[TYPES.get(type)!].background);
      // Show hours with 1 degree of precision.
      const ys = aggregates.map(
          day => Number(day.minutesPerType.get(type)! / 60).toFixed(1));
      data.push({
        x: dates,
        y: ys,
        name: type,
        type: 'bar',
        marker: {
          color: color,
        }
      });
    }

    // @ts-ignore
    Plotly.newPlot(divId, data, {
      barmode: 'stack',
      yaxis: {title: 'Hours'},
    });
  }
}

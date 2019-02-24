import {AsyncOnce} from '../AsyncOnce.js';

import {Aggregate} from './Aggregate.js'
import {CALENDAR_ID, TYPE_TO_COLOR, TYPES} from './Constants.js'

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

type DateRange = [number, number];

interface PlotlySeries {
  x: (Date|number)[], y: (number|string)[], name: string, type: string,
      marker: {
        color: string,
      },
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

  // In theory we can use Dates directly in plotly, but the annotations go crazy
  // when we do. They all get bunched up at the start of the x-axis at
  // positon 2.5 (note...not a date!). Passing the date as a timestamp and
  // annotating the type as a date in the layout seems to resolve it.
  getTimestamp(date: Date) {
    return new Date(date.getUTCFullYear(), date.getMonth(), date.getDate())
        .getTime();
  }

  async chartData(aggregates: Aggregate[], divId: string, range: DateRange) {
    let colors = await this.colors.do();
    const dates = aggregates.map(day => this.getTimestamp(day.start));
    const data: PlotlySeries[] = [];

    let annotations = aggregates.map((day) => {
      let date = this.getTimestamp(day.start);
      let percent = day.bookedPercentage();
      return {
        x: date, xref: 'x', textangle: 270, yref: 'paper', text: percent,
            showarrow: false, bgcolor: 'white', opacity: 0.8,
      }
    });

    for (let type of TYPES.keys()) {
      const calendarColor = colors[TYPES.get(type)!];
      const color = hexToRGB(
          calendarColor ? calendarColor.background : TYPE_TO_COLOR.get(type));
      // Show hours with 1 degree of precision.
      const ys = aggregates.map((day) => {
        let minutes = day.minutesPerType.get(type);
        // TODO: This shouldn't happen, but it does.
        if (minutes === undefined)
          minutes = 0;
        return Number(minutes).toFixed(1);
      });
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
      xaxis: {type: 'date', range: range},
      annotations: annotations,
    });
  }
}

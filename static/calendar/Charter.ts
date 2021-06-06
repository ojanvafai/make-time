import { Aggregate } from './Aggregate.js';
import { CalendarSortListEntry } from './Constants.js';

function hexToRGB(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

type DateRange = [number, number];

interface PlotlySeries {
  x: (Date | number)[];
  y: (number | string)[];
  name: string;
  type: string;
  marker: {
    color: string;
  };
}

export class Charter {
  constructor(private ruleMetadata_: CalendarSortListEntry[]) {}

  // In theory we can use Dates directly in plotly, but the annotations go crazy
  // when we do. They all get bunched up at the start of the x-axis at
  // positon 2.5 (note...not a date!). Passing the date as a timestamp and
  // annotating the type as a date in the layout seems to resolve it.
  getTimestamp(date: Date) {
    return new Date(date.getUTCFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  async chartData(aggregates: Aggregate[], node: Node, range: DateRange) {
    const dates = aggregates.map((day) => this.getTimestamp(day.start));
    const data: PlotlySeries[] = [];

    let annotations = aggregates.map((day) => {
      let date = this.getTimestamp(day.start);
      let percent = day.meTimePercentage();
      return {
        x: date,
        xref: 'x',
        textangle: 270,
        yref: 'paper',
        text: percent,
        showarrow: false,
        bgcolor: 'white',
        opacity: 0.8,
      };
    });

    for (let ruleMetadata of this.ruleMetadata_) {
      let rawColor = ruleMetadata.data.color;
      const color = rawColor.startsWith('rgb') ? rawColor : hexToRGB(rawColor);
      // Show hours with 1 degree of precision.
      const ys = aggregates.map((day) => {
        let minutes = day.minutesPerType.get(ruleMetadata.label);
        // TODO: This shouldn't happen, but it does.
        if (minutes === undefined) minutes = 0;
        return Number(minutes).toFixed(1);
      });
      data.push({
        x: dates,
        y: ys,
        name: ruleMetadata.label,
        type: 'bar',
        marker: {
          color: color,
        },
      });
    }

    data.reverse();

    // @ts-expect-error: TypeScript doesn't know about Plotly
    Plotly.newPlot(node, data, {
      barmode: 'stack',
      yaxis: { title: 'Hours' },
      xaxis: { type: 'date', range: range },
      annotations: annotations,
    });
  }
}

import { memo, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { createAdaptiveStyles, mapColorForMode, type ThemeMode } from '../../../theme/adaptiveStyles';

interface CostHistoryPoint {
  date: string;
  cost: number;
}

interface CostHistoryChartProps {
  points: CostHistoryPoint[];
  themeMode: ThemeMode;
}

const CHART_HEIGHT = 176;
const PAD_H = 8;
const PAD_V = 10;

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return '';
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function buildAreaPath(points: Array<{ x: number; y: number }>, bottomY: number): string {
  if (points.length === 0) {
    return '';
  }
  const first = points[0];
  const last = points[points.length - 1];
  return `${buildLinePath(points)} L ${last.x.toFixed(2)} ${bottomY.toFixed(2)} L ${first.x.toFixed(2)} ${bottomY.toFixed(2)} Z`;
}

export const CostHistoryChart = memo(function CostHistoryChart(props: CostHistoryChartProps): JSX.Element {
  const [width, setWidth] = useState(0);
  const strokeColor = mapColorForMode('#22D3EE', props.themeMode);
  const fillColor = `${strokeColor}24`;

  const normalized = useMemo(
    () =>
      props.points.map((item) => ({
        ...item,
        cost: Math.max(0, Number(item.cost) || 0),
      })),
    [props.points],
  );

  const chart = useMemo(() => {
    if (!normalized.length || width <= 0) {
      return { path: '', areaPath: '', points: [] as Array<{ x: number; y: number }> };
    }

    const safeWidth = Math.max(1, width - PAD_H * 2);
    const safeHeight = Math.max(1, CHART_HEIGHT - PAD_V * 2);
    const maxY = Math.max(0.01, ...normalized.map((item) => item.cost));

    const points = normalized.map((item, index) => {
      const progressX = normalized.length <= 1 ? 0 : index / (normalized.length - 1);
      const progressY = item.cost / maxY;
      return {
        x: PAD_H + safeWidth * progressX,
        y: PAD_V + safeHeight * (1 - progressY),
      };
    });

    return {
      path: buildLinePath(points),
      areaPath: buildAreaPath(points, CHART_HEIGHT - PAD_V),
      points,
    };
  }, [normalized, width]);

  const handleLayout = (event: LayoutChangeEvent): void => {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    if (nextWidth !== width) {
      setWidth(nextWidth);
    }
  };

  const firstLabel = normalized[0]?.date.slice(5) ?? '';
  const lastLabel = normalized[normalized.length - 1]?.date.slice(5) ?? '';
  const totalCost = normalized.reduce((sum, item) => sum + item.cost, 0);

  return (
    <View style={styles.host} onLayout={handleLayout}>
      <Svg width="100%" height={CHART_HEIGHT}>
        {!!chart.areaPath && <Path d={chart.areaPath} fill={fillColor} />}
        {!!chart.path && <Path d={chart.path} stroke={strokeColor} strokeWidth={2.4} fill="none" />}
        {chart.points.map((point, index) => (
          <Circle key={`${index}:${point.x}:${point.y}`} cx={point.x} cy={point.y} r={2.4} fill={strokeColor} />
        ))}
      </Svg>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{firstLabel}</Text>
        <Text style={styles.metaText}>${totalCost.toFixed(2)}</Text>
        <Text style={styles.metaText}>{lastLabel}</Text>
      </View>
    </View>
  );
});

const styles = createAdaptiveStyles({
  host: {
    minHeight: CHART_HEIGHT + 24,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  metaRow: {
    marginTop: -2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
});

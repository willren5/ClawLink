import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { createAdaptiveStyles, mapColorForMode, type ThemeMode } from '../../../theme/adaptiveStyles';
import { useI18n } from '../../../lib/i18n';
import type { LinePoint } from '../types';

interface RequestVolumeChartProps {
  data: LinePoint[];
  themeMode: ThemeMode;
}

const CHART_HEIGHT = 188;
const CHART_PADDING_HORIZONTAL = 8;
const CHART_PADDING_VERTICAL = 10;
const MAX_X_TICK_COUNT = 5;
const SMALL_SCREEN_BREAKPOINT = 640;
const DEFAULT_VISIBLE_POINTS = 72;
const MIN_VISIBLE_POINTS = 12;

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return '';
  }

  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function buildAreaPath(points: Array<{ x: number; y: number }>, bottomY: number): string {
  if (points.length === 0) {
    return '';
  }

  const linePath = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${linePath} L ${last.x.toFixed(2)} ${bottomY.toFixed(2)} L ${first.x.toFixed(2)} ${bottomY.toFixed(2)} Z`;
}

function formatTick(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  if (minutes === '00') {
    return hours;
  }
  return `${hours}:${minutes}`;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function touchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number {
  if (touches.length < 2) {
    return 0;
  }
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY);
}

export const RequestVolumeChart = memo(function RequestVolumeChart(props: RequestVolumeChartProps): JSX.Element {
  const { t } = useI18n();
  const [chartWidth, setChartWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, props.data.length - 1));
  const [visibleCount, setVisibleCount] = useState(
    Math.max(1, Math.min(props.data.length, DEFAULT_VISIBLE_POINTS)),
  );
  const [windowStart, setWindowStart] = useState(
    Math.max(0, props.data.length - Math.max(1, Math.min(props.data.length, DEFAULT_VISIBLE_POINTS))),
  );
  const gestureRef = useRef<{
    mode: 'pan' | 'pinch' | null;
    startX: number;
    startWindowStart: number;
    startVisibleCount: number;
    startDistance: number;
  }>({
    mode: null,
    startX: 0,
    startWindowStart: 0,
    startVisibleCount: 0,
    startDistance: 0,
  });

  useEffect(() => {
    if (!props.data.length) {
      setSelectedIndex(0);
      setVisibleCount(1);
      setWindowStart(0);
      return;
    }

    const boundedVisibleCount = Math.max(1, Math.min(props.data.length, visibleCount));
    const maxWindowStart = Math.max(0, props.data.length - boundedVisibleCount);

    if (boundedVisibleCount !== visibleCount) {
      setVisibleCount(boundedVisibleCount);
    }
    if (windowStart > maxWindowStart) {
      setWindowStart(maxWindowStart);
    }
    if (selectedIndex > props.data.length - 1) {
      setSelectedIndex(props.data.length - 1);
    }
  }, [props.data.length, selectedIndex, visibleCount, windowStart]);

  const resolvedVisibleCount = Math.max(1, Math.min(props.data.length || 1, visibleCount));
  const maxWindowStart = Math.max(0, props.data.length - resolvedVisibleCount);
  const resolvedWindowStart = clamp(windowStart, 0, maxWindowStart);
  const visibleData = props.data.slice(resolvedWindowStart, resolvedWindowStart + resolvedVisibleCount);

  useEffect(() => {
    if (!visibleData.length) {
      return;
    }
    if (
      selectedIndex < resolvedWindowStart ||
      selectedIndex >= resolvedWindowStart + visibleData.length
    ) {
      setSelectedIndex(resolvedWindowStart + visibleData.length - 1);
    }
  }, [resolvedWindowStart, selectedIndex, visibleData.length]);

  const strokeColor = mapColorForMode('#22D3EE', props.themeMode);
  const fillColor = mapColorForMode('#22D3EE', props.themeMode) + '1A';
  const markerColor = mapColorForMode('#38BDF8', props.themeMode);
  const axisColor = mapColorForMode('#64748B', props.themeMode);
  const labelColor = mapColorForMode('#94A3B8', props.themeMode);
  const valueColor = mapColorForMode('#E2E8F0', props.themeMode);

  const chartPoints = useMemo(() => {
    if (!visibleData.length || chartWidth <= 0) {
      return {
        points: [] as Array<{ x: number; y: number }>,
        path: '',
        areaPath: '',
        selected: null as { x: number; y: number } | null,
      };
    }

    const safeWidth = Math.max(1, chartWidth - CHART_PADDING_HORIZONTAL * 2);
    const safeHeight = Math.max(1, CHART_HEIGHT - CHART_PADDING_VERTICAL * 2);
    const maxY = Math.max(1, ...visibleData.map((point) => point.y));
    const minY = 0;

    const points = visibleData.map((point, index) => {
      const xProgress = visibleData.length <= 1 ? 0 : index / (visibleData.length - 1);
      const yProgress = (point.y - minY) / (maxY - minY || 1);

      return {
        x: CHART_PADDING_HORIZONTAL + safeWidth * xProgress,
        y: CHART_PADDING_VERTICAL + safeHeight * (1 - yProgress),
      };
    });

    const path = buildLinePath(points);
    const areaPath = buildAreaPath(points, CHART_HEIGHT - CHART_PADDING_VERTICAL);
    const localSelectedIndex = clamp(
      selectedIndex - resolvedWindowStart,
      0,
      Math.max(0, points.length - 1),
    );
    const selected = points[localSelectedIndex] ?? null;

    return {
      points,
      path,
      areaPath,
      selected,
    };
  }, [chartWidth, resolvedWindowStart, selectedIndex, visibleData]);

  const xTicks = useMemo(() => {
    if (!visibleData.length) {
      return [];
    }

    const preferredTickCount = chartWidth < SMALL_SCREEN_BREAKPOINT ? 3 : 5;
    const tickCount = Math.min(preferredTickCount, MAX_X_TICK_COUNT, visibleData.length);
    if (tickCount <= 1) {
      return [
        {
          key: `${visibleData[0].timestamp}:0`,
          label: formatTick(visibleData[0].timestamp),
        },
      ];
    }

    const tickIndices = Array.from({ length: tickCount }, (_, index) =>
      Math.round((index * (visibleData.length - 1)) / (tickCount - 1)),
    );
    const unique = Array.from(new Set(tickIndices));

    return unique.map((index) => {
      const point = visibleData[index];
      return {
        key: `${point.timestamp}:${index}`,
        label: formatTick(point.timestamp),
      };
    });
  }, [chartWidth, visibleData]);

  const selectedPoint = props.data[clamp(selectedIndex, 0, Math.max(0, props.data.length - 1))];
  const rangeLabel = useMemo(() => {
    if (!visibleData.length) {
      return '';
    }
    const first = visibleData[0];
    const last = visibleData[visibleData.length - 1];
    return `${formatTick(first.timestamp)} → ${formatTick(last.timestamp)} · ${visibleData.length}`;
  }, [visibleData]);

  const handleTouchAtX = (locationX: number, start = resolvedWindowStart, count = resolvedVisibleCount): void => {
    if (chartWidth <= 0 || !props.data.length || count <= 0) {
      return;
    }

    const safeWidth = Math.max(1, chartWidth - CHART_PADDING_HORIZONTAL * 2);
    const normalized = clamp((locationX - CHART_PADDING_HORIZONTAL) / safeWidth, 0, 1);
    const localIndex = Math.round(normalized * Math.max(0, count - 1));
    const globalIndex = clamp(start + localIndex, 0, props.data.length - 1);
    setSelectedIndex(globalIndex);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          const isPinch = touches.length >= 2;
          gestureRef.current = {
            mode: isPinch ? 'pinch' : 'pan',
            startX: event.nativeEvent.locationX,
            startWindowStart: resolvedWindowStart,
            startVisibleCount: resolvedVisibleCount,
            startDistance: isPinch ? touchDistance(touches) : 0,
          };
          handleTouchAtX(event.nativeEvent.locationX, resolvedWindowStart, resolvedVisibleCount);
        },
        onPanResponderMove: (event) => {
          const touches = event.nativeEvent.touches;
          if (!props.data.length) {
            return;
          }

          if (touches.length >= 2) {
            const nextDistance = touchDistance(touches);
            if (gestureRef.current.mode !== 'pinch') {
              gestureRef.current.mode = 'pinch';
              gestureRef.current.startDistance = nextDistance || 1;
              gestureRef.current.startVisibleCount = resolvedVisibleCount;
              gestureRef.current.startWindowStart = resolvedWindowStart;
            }

            const baselineDistance = Math.max(1, gestureRef.current.startDistance || nextDistance || 1);
            const ratio = nextDistance / baselineDistance;
            const minimumVisible = Math.max(1, Math.min(MIN_VISIBLE_POINTS, props.data.length));
            const nextVisibleCount = clamp(
              Math.round(gestureRef.current.startVisibleCount * ratio),
              minimumVisible,
              props.data.length,
            );
            const anchorCenter =
              gestureRef.current.startWindowStart + gestureRef.current.startVisibleCount / 2;
            const nextWindowStart = clamp(
              Math.round(anchorCenter - nextVisibleCount / 2),
              0,
              Math.max(0, props.data.length - nextVisibleCount),
            );

            setVisibleCount(nextVisibleCount);
            setWindowStart(nextWindowStart);
            handleTouchAtX(event.nativeEvent.locationX, nextWindowStart, nextVisibleCount);
            return;
          }

          if (gestureRef.current.mode !== 'pan') {
            gestureRef.current.mode = 'pan';
            gestureRef.current.startX = event.nativeEvent.locationX;
            gestureRef.current.startWindowStart = resolvedWindowStart;
            gestureRef.current.startVisibleCount = resolvedVisibleCount;
          }

          const safeWidth = Math.max(1, chartWidth - CHART_PADDING_HORIZONTAL * 2);
          const pointsPerPixel = Math.max(1, gestureRef.current.startVisibleCount - 1) / safeWidth;
          const delta = event.nativeEvent.locationX - gestureRef.current.startX;
          const nextWindowStart = clamp(
            Math.round(gestureRef.current.startWindowStart - delta * pointsPerPixel),
            0,
            Math.max(0, props.data.length - gestureRef.current.startVisibleCount),
          );

          setWindowStart(nextWindowStart);
          handleTouchAtX(event.nativeEvent.locationX, nextWindowStart, gestureRef.current.startVisibleCount);
        },
        onPanResponderRelease: () => {
          gestureRef.current.mode = null;
        },
        onPanResponderTerminate: () => {
          gestureRef.current.mode = null;
        },
      }),
    [chartWidth, props.data.length, resolvedVisibleCount, resolvedWindowStart],
  );

  const handleLayout = (event: LayoutChangeEvent): void => {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    if (nextWidth !== chartWidth) {
      setChartWidth(nextWidth);
    }
  };

  return (
    <View style={styles.wrap}>
      {!!selectedPoint && (
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryText, { color: valueColor }]}>
            {formatTick(selectedPoint.timestamp)} · {selectedPoint.y} {t('dashboard_chart_requests_suffix')}
          </Text>
          <Text style={[styles.summaryHint, { color: labelColor }]}>
            {t('dashboard_chart_tap_hint')}
          </Text>
        </View>
      )}

      <View style={styles.windowRow}>
        <Text style={[styles.windowLabel, { color: labelColor }]} numberOfLines={1}>
          {rangeLabel}
        </Text>
        <Text style={[styles.windowHint, { color: labelColor }]}>
          {props.data.length} pts
        </Text>
      </View>

      <View style={styles.chartHost} onLayout={handleLayout} {...panResponder.panHandlers}>
        <Svg width="100%" height={CHART_HEIGHT}>
          {chartPoints.areaPath ? <Path d={chartPoints.areaPath} fill={fillColor} /> : null}
          {chartPoints.path ? <Path d={chartPoints.path} stroke={strokeColor} strokeWidth={2.5} fill="none" /> : null}
          {chartPoints.selected ? (
            <Circle cx={chartPoints.selected.x} cy={chartPoints.selected.y} r={4.5} fill={markerColor} />
          ) : null}
          <Path
            d={`M ${CHART_PADDING_HORIZONTAL} ${CHART_HEIGHT - CHART_PADDING_VERTICAL} L ${Math.max(CHART_PADDING_HORIZONTAL, chartWidth - CHART_PADDING_HORIZONTAL)} ${CHART_HEIGHT - CHART_PADDING_VERTICAL}`}
            stroke={axisColor}
            strokeWidth={1}
            fill="none"
          />
        </Svg>
      </View>

      <View style={styles.ticksRow}>
        {xTicks.map((tick, index) => (
          <View key={tick.key} style={styles.tickSlot}>
            <Text
              style={[
                styles.tickText,
                {
                  color: axisColor,
                  textAlign: index === 0 ? 'left' : index === xTicks.length - 1 ? 'right' : 'center',
                },
              ]}
              numberOfLines={1}
            >
              {tick.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

const styles = createAdaptiveStyles({
  wrap: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    gap: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
    paddingHorizontal: 2,
  },
  summaryText: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryHint: {
    fontSize: 11,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  windowLabel: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  windowHint: {
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 8,
  },
  chartHost: {
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    backgroundColor: '#0F172A',
    overflow: 'hidden',
  },
  ticksRow: {
    height: 17,
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tickSlot: {
    flex: 1,
  },
  tickText: {
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});

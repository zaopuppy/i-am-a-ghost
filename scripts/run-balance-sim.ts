import { writeFile } from 'node:fs/promises';
import { runBotMatch, type BotMatchMetrics } from '../src/testing/BalanceSimulation';

interface AggregateRow {
  childCount: number;
  matches: number;
  childWinRate: number;
  averageEffectiveDurationSeconds: number;
  firstCaptureReachRate: number;
  averageFirstCaptureSeconds: number | null;
  thirdCaptureReachRate: number;
  averageThirdCaptureSeconds: number | null;
  firstBeamReachRate: number;
  averageFirstBeamSeconds: number | null;
  averageEffectiveBeamSeconds: number;
  averageBatterySpawns: number;
  batteryCollectionRate: number;
  averageBatteryPickupDelaySeconds: number | null;
  averageBatteryDepletionsPerChild: number;
  averageDoorwayBlockEpisodes: number;
  averageWarningBandSeconds: BotMatchMetrics['warningBandSeconds'];
  minimumHumanDistance: number;
  permanentOverlaps: number;
  wallPenetrations: number;
  softlockWindows: number;
}

const runs = positiveInteger(argument('--runs') ?? '24', '--runs');
const seedBase = positiveInteger(argument('--seed-base') ?? '8100', '--seed-base');
const outputPath = argument('--out');
const matches: BotMatchMetrics[] = [];
for (let childCount = 1; childCount <= 4; childCount += 1) {
  for (let run = 0; run < runs; run += 1) {
    matches.push(runBotMatch({ childCount, seed: seedBase + childCount * 100 + run }));
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  rules: 'M6 deterministic high-skill bots on DEFAULT_HOUSE_MAP',
  runsPerChildCount: runs,
  seedBase,
  rows: Array.from({ length: 4 }, (_, index) => aggregate(matches.filter((match) => match.childCount === index + 1))),
  matches,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized, 'utf8');
process.stdout.write(serialized);

function aggregate(values: readonly BotMatchMetrics[]): AggregateRow {
  const firstCaptures = present(values.map((value) => value.firstCaptureSeconds));
  const thirdCaptures = present(values.map((value) => value.thirdCaptureSeconds));
  const firstBeams = present(values.map((value) => value.firstBeamHitSeconds));
  const pickupDelays = present(values.map((value) => value.averageBatteryPickupDelaySeconds));
  const batterySpawns = sum(values.map((value) => value.batterySpawns));
  return {
    childCount: values[0]?.childCount ?? 0,
    matches: values.length,
    childWinRate: ratio(values.filter((value) => value.winner === 'children').length, values.length),
    averageEffectiveDurationSeconds: rounded(average(values.map((value) => value.effectiveDurationSeconds))),
    firstCaptureReachRate: ratio(firstCaptures.length, values.length),
    averageFirstCaptureSeconds: nullableAverage(firstCaptures),
    thirdCaptureReachRate: ratio(thirdCaptures.length, values.length),
    averageThirdCaptureSeconds: nullableAverage(thirdCaptures),
    firstBeamReachRate: ratio(firstBeams.length, values.length),
    averageFirstBeamSeconds: nullableAverage(firstBeams),
    averageEffectiveBeamSeconds: rounded(average(values.map((value) => value.effectiveBeamSeconds))),
    averageBatterySpawns: rounded(average(values.map((value) => value.batterySpawns))),
    batteryCollectionRate: ratio(sum(values.map((value) => value.batteryCollections)), batterySpawns),
    averageBatteryPickupDelaySeconds: nullableAverage(pickupDelays),
    averageBatteryDepletionsPerChild: rounded(average(values.map((value) => value.averageBatteryDepletions))),
    averageDoorwayBlockEpisodes: rounded(average(values.map((value) => value.doorwayBlockEpisodes))),
    averageWarningBandSeconds: {
      off: rounded(average(values.map((value) => value.warningBandSeconds.off))),
      slow: rounded(average(values.map((value) => value.warningBandSeconds.slow))),
      fast: rounded(average(values.map((value) => value.warningBandSeconds.fast))),
      solid: rounded(average(values.map((value) => value.warningBandSeconds.solid))),
    },
    minimumHumanDistance: rounded(Math.min(...values.map((value) => value.minimumHumanDistance))),
    permanentOverlaps: values.filter((value) => value.permanentOverlap).length,
    wallPenetrations: sum(values.map((value) => value.wallPenetrations)),
    softlockWindows: sum(values.map((value) => value.softlockWindows)),
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RangeError(`${name} must be a positive integer.`);
  return parsed;
}

function present(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

function nullableAverage(values: readonly number[]): number | null {
  return values.length > 0 ? rounded(average(values)) : null;
}

function average(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? rounded(numerator / denominator) : 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

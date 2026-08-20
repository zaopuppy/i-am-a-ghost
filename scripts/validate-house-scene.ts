import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileHouseScene, isHouseSceneDefinition } from '../src/game/HouseScene';

const defaultScenePath = 'assets/maps/m3-nine-room-house.scene.json';
const requestedPath = process.argv[2] ?? defaultScenePath;
const scenePath = resolve(requestedPath);

try {
  const source = JSON.parse(await readFile(scenePath, 'utf8')) as unknown;
  if (!isHouseSceneDefinition(source)) {
    throw new Error('JSON does not match the supported HouseSceneDefinition structure.');
  }

  const compiled = compileHouseScene(source);
  console.log(
    `Map ${compiled.definition.id}: ${compiled.rooms.length} rooms, `
    + `${compiled.definition.walls.length} walls, ${compiled.furniture.length} furniture, `
    + `${compiled.map.movementObstacles?.length ?? 0} movement colliders.`,
  );

  if (compiled.issues.length === 0) {
    console.log('Validation passed with no issues.');
  } else {
    for (const issue of compiled.issues) {
      console.log(`${issue.severity.toUpperCase()} ${issue.code} [${issue.subjectId}]: ${issue.message}`);
    }
  }

  if (compiled.issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
} catch (error) {
  console.error(`Unable to validate ${scenePath}:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

import type { Car, Controls } from "./car";
import type { TrafficCar } from "./traffic";
import type { Obstacle, Segment, Track } from "./track";

/**
 * Advance one car on a track: update its progress/laps, feed it only the
 * nearby walls + obstacles (cheap raycasting) and run its physics.
 */
export function stepCarOnTrack(
  track: Track,
  car: Car,
  traffic: TrafficCar[],
  keyControls?: Controls,
) {
  if (car.damaged || car.finished) {
    if (car.sensor) car.sensor.update(car, [], []);
    return;
  }

  const index = track.nearestIndex(car, car.trackIndex, 30);
  const prevIndex = car.trackIndex;
  car.trackIndex = index;

  const n = track.centerline.length;
  if (track.closed) {
    if (prevIndex > n * 0.8 && index < n * 0.2) car.laps++;
    else if (prevIndex < n * 0.2 && index > n * 0.8 && car.laps > 0) car.laps--;
  }

  const along = track.distanceAtIndex(index) + car.laps * track.total;
  car.progress = along;
  if (along > car.bestProgress + 0.5) {
    car.bestProgress = along;
    car.idleTicks = 0;
  } else {
    car.idleTicks++;
  }

  if (!track.closed && along >= track.total - 120) {
    car.finished = true;
    return;
  }

  const borders: Segment[] = track.segmentsNear(index, 7);
  const obstacles: Obstacle[] = [];
  for (const t of traffic) {
    if (Math.abs(t.x - car.x) < 320 && Math.abs(t.y - car.y) < 320) {
      obstacles.push({ polygon: t.polygon });
    }
  }
  for (const o of track.obstacles) {
    if (
      Math.abs(o.polygon[0].x - car.x) < 320 &&
      Math.abs(o.polygon[0].y - car.y) < 320
    ) {
      obstacles.push(o);
    }
  }

  car.update(borders, obstacles, keyControls);
}

const DEFAULT_METERS_PER_PIXEL = 0.6;
const DEFAULT_WALKING_SPEED_MPM = 80;

export function buildSimpleRoute(sourcePlace, destinationPlace) {
  if (!sourcePlace || !destinationPlace) return [];
  return [sourcePlace.position, destinationPlace.position];
}

export function calculateDistanceMeters(
  sourcePlace,
  destinationPlace,
  metersPerPixel = DEFAULT_METERS_PER_PIXEL,
) {
  if (!sourcePlace || !destinationPlace) return 0;

  const [sourceY, sourceX] = sourcePlace.position;
  const [destinationY, destinationX] = destinationPlace.position;
  const pixelDistance = Math.hypot(destinationY - sourceY, destinationX - sourceX);

  return Math.round(pixelDistance * metersPerPixel);
}

export function calculateEtaMinutes(
  distanceMeters,
  walkingSpeedMetersPerMinute = DEFAULT_WALKING_SPEED_MPM,
) {
  if (!distanceMeters) return 0;
  return Math.max(1, Math.ceil(distanceMeters / walkingSpeedMetersPerMinute));
}

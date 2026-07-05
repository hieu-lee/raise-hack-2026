export interface Cluster<T> {
  id: string;
  seed: T;
  items: T[];
}

export function clusterByThreshold<T>(
  items: T[],
  threshold: number,
  distance: (first: T, second: T) => number,
  idFor: (seed: T, index: number) => string
): Cluster<T>[] {
  const clusters: Cluster<T>[] = [];

  for (const item of items) {
    const cluster = clusters.find((candidate) => distance(candidate.seed, item) <= threshold);
    if (cluster) {
      cluster.items.push(item);
      continue;
    }

    clusters.push({ id: idFor(item, clusters.length), seed: item, items: [item] });
  }

  return clusters;
}

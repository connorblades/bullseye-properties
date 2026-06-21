/** Minimal GeoJSON shapes used by the interactive map data layers. */
export type GeoFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown>;
};
export type GeoCollection = {
  type: 'FeatureCollection';
  features: GeoFeature[];
};

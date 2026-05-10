// src/services/routeService.js
import api from './api';

/**
 * Fetch optimal + alternative routes from the backend.
 *
 * @param {string} source       Building name OR road node ID (e.g. "N5")
 * @param {string} destination  Building name OR road node ID
 * @param {number} k            Number of candidate routes (default 3)
 * @returns {Promise<{
 *   source: string,
 *   destination: string,
 *   recommendedIndex: number,
 *   routes: Array<{
 *     nodes: string[],
 *     distance: number,
 *     time: number,
 *     crowdSummary: string,
 *     crowdCounts: { low: number, medium: number, high: number },
 *     blocked: boolean,
 *     score: number,
 *   }>
 * }>}
 */
export async function getOptimalRoutes(source, destination, k = 3) {
  const res = await api.post('/routes/optimal', { source, destination, k });
  return res.data;
}

/** Get all available road node IDs */
export async function getRouteNodes() {
  const res = await api.get('/routes/nodes');
  return res.data;
}

/** Get all building names (for custom dropdowns) */
export async function getBuildings() {
  const res = await api.get('/routes/buildings');
  return res.data;
}
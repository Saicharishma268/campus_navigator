import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ImageOverlay, MapContainer, Marker, Polyline, Popup } from 'react-leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let markerIconConfigured = false;

function configureMarkerIcons() {
  if (markerIconConfigured) return;

  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });

  markerIconConfigured = true;
}

function CampusMap({ mapImageUrl, mapBounds, places, routeCoordinates }) {
  configureMarkerIcons();

  return (
    <div className="h-[60vh] min-h-[420px] overflow-hidden rounded-lg border border-slate-200">
      <MapContainer
        crs={L.CRS.Simple}
        bounds={mapBounds}
        maxBounds={mapBounds}
        maxBoundsViscosity={1}
        minZoom={-1}
        maxZoom={2}
        zoom={0}
        scrollWheelZoom
        className="h-full w-full"
      >
        <ImageOverlay url={mapImageUrl} bounds={mapBounds} />

        {places.map((place) => (
          <Marker key={place.id} position={place.position}>
            <Popup>{place.name}</Popup>
          </Marker>
        ))}

        {routeCoordinates.length > 1 ? (
          <Polyline positions={routeCoordinates} pathOptions={{ color: '#2563eb', weight: 6 }} />
        ) : null}
      </MapContainer>
    </div>
  );
}

export default CampusMap;

import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createRoute } from '../utils/mapbox';

// Add driver marker styles to the document head
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  .driver-marker {
    width: 40px;
    height: 40px;
  }
  
  .driver-marker-pulse {
    position: absolute;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(79, 70, 229, 0.2);
    animation: pulse 2s ease-out infinite;
    z-index: -1;
  }
  
  @keyframes pulse {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  }
`;
document.head.appendChild(styleSheet);

interface MapProps {
  className?: string;
  origin?: [number, number];
  destination?: [number, number];
  showRoute?: boolean;
  driverLocation?: [number, number];
  autoUpdate?: boolean;
  onlineDrivers?: Array<{
    id: string;
    currentLocation: [number, number];
    name?: string;
    vehicle?: {
      model?: string;
      plate?: string;
      color?: string;
    };
    rating?: number;
  }>;
}

const Map = ({ 
  className = '', 
  origin, 
  destination, 
  showRoute = false,
  driverLocation,
  autoUpdate = false,
  onlineDrivers = []
}: MapProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const driverMarkersRef = useRef<{[key: string]: mapboxgl.Marker}>({});
  const routeRef = useRef<string | null>(null);

  // Inicializar mapa
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!mapboxToken) {
      console.error('Token do Mapbox não encontrado nas variáveis de ambiente');
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const initialCoordinates = origin || [-43.9345, -19.9279]; // Coordenadas padrão (BH)
    
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialCoordinates,
      zoom: 13
    });

    return () => {
      // Limpar todos os marcadores
      markersRef.current.forEach(marker => marker.remove());
      markersRef.current = [];
      
      Object.values(driverMarkersRef.current).forEach(marker => marker.remove());
      driverMarkersRef.current = {};

      // Remover o mapa
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []); // Inicializar apenas uma vez

  // Atualizar marcadores e rota
  useEffect(() => {
    if (!map.current) return;

    // Limpar marcadores existentes
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    // Adicionar marcadores apenas se showRoute for true
    if (showRoute) {
      // Adicionar marcador de origem
      if (origin) {
        const originMarker = new mapboxgl.Marker({ color: '#4F46E5' })
          .setLngLat(origin)
          .addTo(map.current);
        markersRef.current.push(originMarker);
      }

      // Adicionar marcador de destino
      if (destination) {
        const destinationMarker = new mapboxgl.Marker({ color: '#7C3AED' })
          .setLngLat(destination)
          .addTo(map.current);
        markersRef.current.push(destinationMarker);
      }
    }

    // Centralizar mapa na origem ou em coordenadas padrão
    const centerCoordinates = origin || [-43.9345, -19.9279];
    map.current.easeTo({
      center: centerCoordinates,
      zoom: 13,
      duration: 1000
    });

    // Atualizar rota se necessário
    if (showRoute && origin && destination && map.current) {
      createRoute(origin, destination).then(route => {
        if (!map.current) return;

        // Remover rota anterior se existir
        if (routeRef.current && map.current.getLayer(routeRef.current)) {
          map.current.removeLayer(routeRef.current);
          map.current.removeSource(routeRef.current);
        }

        const routeId = `route-${Date.now()}`;
        routeRef.current = routeId;

        map.current.addSource(routeId, {
          type: 'geojson',
          data: route
        });

        map.current.addLayer({
          id: routeId,
          type: 'line',
          source: routeId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': '#4F46E5',
            'line-width': 4,
            'line-opacity': 0.75
          }
        });

        // Ajustar o zoom para mostrar a rota completa
        const coordinates = route.geometry.coordinates as [number, number][];
        const bounds = coordinates.reduce((bounds: mapboxgl.LngLatBounds, coord: [number, number]) => {
          return bounds.extend(coord as mapboxgl.LngLatLike);
        }, new mapboxgl.LngLatBounds(coordinates[0] as mapboxgl.LngLatLike, coordinates[0] as mapboxgl.LngLatLike));

        map.current.fitBounds(bounds, {
          padding: 50,
          duration: 1000
        });
      });
    }
  }, [origin, destination, showRoute]);

  // Atualizar marcadores dos motoristas
  useEffect(() => {
    // Desativado temporariamente para não mostrar motoristas online
    return;
    
    /*
    const currentMap = map.current;
    if (!currentMap) return;

    const currentDrivers = new Set(onlineDrivers.map(d => d.id));
    const updatedMarkers: {[key: string]: mapboxgl.Marker} = {};

    // Atualizar ou criar marcadores
    onlineDrivers.forEach(driver => {
      if (driverMarkersRef.current[driver.id]) {
        // Atualizar posição do marcador existente
        driverMarkersRef.current[driver.id].setLngLat(driver.currentLocation);
        updatedMarkers[driver.id] = driverMarkersRef.current[driver.id];
      } else {
        // Criar novo marcador
        const el = document.createElement('div');
        el.className = 'driver-marker relative';
        el.innerHTML = `
          <div class="driver-marker-pulse"></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <div class="w-10 h-10 bg-primary-600 rounded-full flex items-center justify-center shadow-lg transform -translate-x-1/2 -translate-y-1/2">
              <svg viewBox="0 0 24 24" class="w-6 h-6 text-white fill-current">
                <path d="M12 4H5C3.89 4 3 4.89 3 6V18C3 19.11 3.89 20 5 20H19C20.11 20 21 19.11 21 18V8H12V4ZM12 4V8H21L12 4ZM5 18V6H19V18H5ZM7 9H17V11H7V9ZM7 12H17V14H7V12ZM7 15H14V17H7V15Z"/>
              </svg>
            </div>
          </div>
          <div class="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-white px-2 py-1 rounded-full shadow-md text-xs font-medium text-gray-700">
            Motorista Online
          </div>
        `;

        const marker = new mapboxgl.Marker(el)
          .setLngLat(driver.currentLocation)
          .addTo(currentMap);
        
        // Adicionar popup com informações do motorista
        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: true,
          offset: [0, -15],
          className: 'rounded-lg shadow-lg'
        });

        // Criar conteúdo do popup
        const popupContent = document.createElement('div');
        popupContent.className = 'p-3 min-w-[200px]';
        popupContent.innerHTML = `
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <h3 class="font-medium text-gray-900">${driver.name || 'Motorista'}</h3>
              ${driver.rating ? `
                <div class="flex items-center text-yellow-500">
                  <svg class="w-4 h-4 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                  </svg>
                  <span class="ml-1 text-sm">${driver.rating.toFixed(1)}</span>
                </div>
              ` : ''}
            </div>
            ${driver.vehicle ? `
              <div class="text-sm text-gray-600">
                <p>${driver.vehicle.model || ''} ${driver.vehicle.color || ''}</p>
                <p class="font-medium">${driver.vehicle.plate || ''}</p>
              </div>
            ` : ''}
            <button 
              class="w-full bg-primary-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors"
              onclick="window.location.href='/solicitar'"
            >
              Solicitar Corrida
            </button>
          </div>
        `;

        // Adicionar evento de clique no marcador
        el.addEventListener('click', () => {
          popup.setLngLat(driver.currentLocation)
            .setDOMContent(popupContent)
            .addTo(currentMap);
        });
        
        updatedMarkers[driver.id] = marker;
      }
    });

    // Remover marcadores antigos
    Object.entries(driverMarkersRef.current).forEach(([id, marker]) => {
      if (!currentDrivers.has(id)) {
        marker.remove();
      }
    });

    driverMarkersRef.current = updatedMarkers;
    */
  }, [onlineDrivers]);

  // Atualizar localização do motorista
  useEffect(() => {
    if (!map.current || !driverLocation || !autoUpdate) return;

    map.current.easeTo({
      center: driverLocation,
      duration: 1000
    });
  }, [driverLocation, autoUpdate]);

  return <div ref={mapContainer} className={className} />;
};

export default Map;
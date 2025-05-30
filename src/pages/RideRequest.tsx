import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { MapPin, Navigation, X, ChevronRight, Car, UserCheck, ShieldCheck, CreditCard, User as UserIcon, Star, Phone, Bell } from 'lucide-react';
import { collection, query, getDocs, addDoc, Timestamp, doc, deleteDoc, updateDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { db, COLLECTIONS } from '../utils/firebase';
import { useAuth } from '../contexts/AuthContext';
import { geocodeAddress, getCurrentLocation, reverseGeocode, createRoute } from '../utils/mapbox';
import Map from '../components/Map';
import { toast } from 'react-hot-toast';
import { calculatePrice } from '../utils/pricing';
import { Location, Driver, RouteResponse } from '../types/mapbox';
import { User, Ride } from '../types/user';
import { sendNotification } from '../utils/notifications';

type LocationType = {
  id: string;
  place: string;
  address: string;
  coordinates: [number, number];
};

interface DriverType {
  id: string;
  name: string;
  currentLocation?: [number, number];
  rating?: number;
  vehicle?: {
    model: string;
    plate: string;
    color: string;
  };
  phone?: string;
}

interface Driver extends DriverType {
  rating: number;
  vehicle: {
    model: string;
    plate: string;
    color: string;
  };
  phone: string;
}

interface VehicleCategory {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  pricePerKm: number;
  minPrice: number;
  icon: string;
  dynamicPricing: {
    rainMultiplier: number;
    peakHoursMultiplier: number;
    peakHours: {
      start: string;
      end: string;
    }[];
  };
  estimatedPrice?: number;
  estimatedTime?: string;
}

type PaymentMethod = 'pix' | 'card' | 'cash';

type Step = 'location' | 'categories' | 'confirmation';

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas em milissegundos

const RideRequest = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const initialDestination = searchParams.get('dest') || '';
  const initialOrigin = searchParams.get('orig') || '';
  
  const [origin, setOrigin] = useState<LocationType | null>(null);
  const [destination, setDestination] = useState<LocationType | null>(null);
  const [originQuery, setOriginQuery] = useState(initialOrigin);
  const [destinationQuery, setDestinationQuery] = useState(initialDestination);
  const [searchResults, setSearchResults] = useState<LocationType[]>([]);
  const [currentStep, setCurrentStep] = useState<Step>('location');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('pix');
  const [isSearching, setIsSearching] = useState(false);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [rideId, setRideId] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverType | null>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [quickDestinationName, setQuickDestinationName] = useState('');
  
  // Carregar categorias de veículos com cache
  useEffect(() => {
    const loadCategories = async () => {
      try {
        console.log('Iniciando carregamento de categorias...');
        
        // Verificar cache primeiro
        const cachedData = localStorage.getItem('vehicleCategories');
        const cacheTimestamp = localStorage.getItem('vehicleCategoriesTimestamp');
        
        if (cachedData && cacheTimestamp) {
          const isValid = Date.now() - Number(cacheTimestamp) < CACHE_DURATION;
          if (isValid) {
            console.log('Usando dados do cache');
            const parsedCategories = JSON.parse(cachedData);
            setCategories(parsedCategories);
            setLoading(false);
            return;
          }
        }
        
        // Se não houver cache válido, buscar do Firestore
        const categoriesRef = collection(db, 'vehicleCategories');
        const q = query(categoriesRef);
        const querySnapshot = await getDocs(q);
        
        console.log('Número de categorias encontradas:', querySnapshot.size);
        
        if (querySnapshot.empty) {
          console.log('Nenhuma categoria encontrada');
          setCategories([]);
          setLoading(false);
          return;
        }

        const loadedCategories = querySnapshot.docs.map(doc => {
          const data = doc.data();
          console.log('Dados brutos da categoria:', { id: doc.id, ...data });
          
          return {
            id: doc.id,
            name: data.name || '',
            description: data.description || '',
            basePrice: Number(data.basePrice) || 0,
            pricePerKm: Number(data.pricePerKm) || 0,
            minPrice: Number(data.minPrice) || 0,
            icon: data.icon || '🚗',
            dynamicPricing: {
              rainMultiplier: Number(data.dynamicPricing?.rainMultiplier) || 1.2,
              peakHoursMultiplier: Number(data.dynamicPricing?.peakHoursMultiplier) || 1.5,
              peakHours: Array.isArray(data.dynamicPricing?.peakHours) ? 
                data.dynamicPricing.peakHours : [
                  { start: "07:00", end: "09:00" },
                  { start: "17:00", end: "19:00" }
                ]
            }
          };
        });

        // Atualizar cache
        localStorage.setItem('vehicleCategories', JSON.stringify(loadedCategories));
        localStorage.setItem('vehicleCategoriesTimestamp', Date.now().toString());

        console.log('Categorias processadas:', loadedCategories);
        setCategories(loadedCategories);
      } catch (error) {
        console.error('Erro ao carregar categorias:', error);
        toast.error('Erro ao carregar categorias de veículos');
      } finally {
        setLoading(false);
      }
    };

    loadCategories();
  }, []); // Remover dependências desnecessárias

  // Atualizar preços e tempos estimados quando origem ou destino mudarem
  useEffect(() => {
    if (origin && destination && categories.length > 0) {
      const updatedCategories = categories.map(category => {
        const distance = calculateDistance(
          origin.coordinates[0],
          origin.coordinates[1],
          destination.coordinates[0],
          destination.coordinates[1]
        );
        
        let price = category.basePrice + (distance * category.pricePerKm);
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        const isPeakHour = category.dynamicPricing.peakHours.some(period => 
          currentTime >= period.start && currentTime <= period.end
        );
        
        if (isPeakHour) {
          price *= category.dynamicPricing.peakHoursMultiplier;
        }
        
        price = Math.max(price, category.minPrice);
        
        const timeInHours = distance / 30;
        const timeInMinutes = Math.ceil(timeInHours * 60);
        
        return {
          ...category,
          estimatedPrice: price,
          estimatedTime: `${timeInMinutes} min`
        };
      });
      
      setCategories(updatedCategories);
    }
  }, [origin, destination]);

  // Carregar localização atual ao montar o componente
  useEffect(() => {
    const loadCurrentLocation = async () => {
      try {
        const coordinates = await getCurrentLocation();
        const address = await reverseGeocode(coordinates);
        
        const currentLocation: LocationType = {
          id: 'current-location',
          place: address.placeName.split(',')[0],
          address: address.address,
          coordinates: coordinates
        };
        
        setOrigin(currentLocation);
        setOriginQuery(currentLocation.place);
      } catch (error) {
        console.error('Erro ao obter localização atual:', error);
      }
    };

    loadCurrentLocation();
  }, []);

  // Carregar endereços iniciais da URL
  useEffect(() => {
    const loadAddressFromUrl = async () => {
      if (initialOrigin) {
        try {
          const result = await geocodeAddress(initialOrigin);
          const location: LocationType = {
            id: result.placeName,
            place: result.placeName.split(',')[0],
            address: result.address,
            coordinates: result.coordinates
          };
          setOrigin(location);
        } catch (error) {
          console.error('Erro ao carregar endereço de origem:', error);
        }
      }

      if (initialDestination) {
        try {
          const result = await geocodeAddress(initialDestination);
          const location: LocationType = {
            id: result.placeName,
            place: result.placeName.split(',')[0],
            address: result.address,
            coordinates: result.coordinates
          };
          setDestination(location);
        } catch (error) {
          console.error('Erro ao carregar endereço de destino:', error);
        }
      }
    };

    loadAddressFromUrl();
  }, [initialOrigin, initialDestination]);

  // Buscar locais usando geocodificação real
  useEffect(() => {
    const searchTimeout = setTimeout(async () => {
      const query = origin ? destinationQuery : originQuery;
      
      if (query.length < 3) {
        setSearchResults([]);
        return;
      }
      
      setIsSearching(true);
      
      try {
        const result = await geocodeAddress(query);
        const location: LocationType = {
          id: result.placeName,
          place: result.placeName.split(',')[0],
          address: result.address,
          coordinates: result.coordinates
        };
        
        setSearchResults([location]);
      } catch (error) {
        console.error('Erro ao buscar endereço:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(searchTimeout);
  }, [originQuery, destinationQuery, origin]);
  
  const handleSelectLocation = (location: LocationType) => {
    if (!origin) {
      setOrigin(location);
      setOriginQuery('');
      // Focus destination input automatically
      setTimeout(() => {
        const destInput = document.getElementById('destination-input');
        if (destInput) destInput.focus();
      }, 100);
    } else {
      setDestination(location);
      setDestinationQuery('');
      // Não avançar automaticamente para a próxima etapa
    }
  };
  
  const handleSelectCategory = (categoryId: string) => {
    setSelectedCategory(categoryId);
  };
  
  const handleResetLocation = (type: 'origin' | 'destination') => {
    if (type === 'origin') {
      setOrigin(null);
      setOriginQuery('');
      // Reset destination too if user wants to change origin
      if (currentStep !== 'location') {
        setDestination(null);
        setDestinationQuery('');
        setCurrentStep('location');
      }
    } else {
      setDestination(null);
      setDestinationQuery('');
      if (currentStep !== 'location') {
        setCurrentStep('location');
      }
    }
  };
  
  const handleConfirmRide = async () => {
    if (!user || !origin || !destination || !selectedCategory) {
      console.error('Dados faltando:', { user, origin, destination, selectedCategory });
      return;
    }
    
    try {
      // Verificar se o usuário tem permissão para criar corridas
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        console.error('Usuário não encontrado no Firestore');
        toast.error('Erro ao verificar permissões do usuário');
        return;
      }

      const userData = userDoc.data();
      if (userData.role !== 'passenger') {
        console.error('Usuário não tem permissão para criar corridas:', userData);
        toast.error('Você não tem permissão para solicitar corridas');
        return;
      }

      const selectedVehicle = categories.find(c => c.id === selectedCategory);
      if (!selectedVehicle) {
        toast.error('Categoria de veículo não encontrada');
        return;
      }

      // Calcular distância real da rota
      const routeInfo = await createRoute(origin.coordinates, destination.coordinates);
      if (!routeInfo) {
        toast.error('Erro ao calcular a rota. Tente novamente.');
        return;
      }

      // Calcular preço baseado na distância e categoria
      const price = calculatePrice(
        routeInfo.properties.distance,
        selectedVehicle.pricePerKm,
        selectedVehicle.basePrice
      );

      // Criar a corrida com todos os dados necessários em uma única operação
      const newRide = {
        userId: user.uid,
        userName: user.displayName || 'Usuário',
        origin: {
          place: origin.place,
          address: origin.address,
          coordinates: origin.coordinates
        },
        destination: {
          place: destination.place,
          address: destination.address,
          coordinates: destination.coordinates
        },
        status: 'pending',
        createdAt: Timestamp.now(),
        distance: routeInfo.properties.distance,
        duration: routeInfo.properties.duration,
        price: price,
        driverId: null,
        driver: null,
        vehicleCategory: selectedCategory,
        paymentMethod: selectedPayment
      };
      
      // Tentar criar a corrida com retry em caso de erro de quota
      const createRideWithRetry = async (retryCount = 0) => {
        try {
          console.log('Tentando criar corrida:', newRide); // Log para debug
          const ridesRef = collection(db, COLLECTIONS.ACTIVE_RIDES);
          const docRef = await addDoc(ridesRef, newRide);
          console.log('Corrida criada com sucesso, ID:', docRef.id); // Log para debug
          setRideId(docRef.id);
          toast.success('Corrida solicitada com sucesso!');
        } catch (error: any) {
          console.error('Erro detalhado ao criar corrida:', error); // Log detalhado do erro
          if (error.code === 'resource-exhausted' && retryCount < 3) {
            toast.loading('Sistema ocupado, tentando novamente...');
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
            return createRideWithRetry(retryCount + 1);
          }
          throw error;
        }
      };

      await createRideWithRetry();
    } catch (error: any) {
      console.error('Erro ao criar corrida:', error);
      if (error.code === 'resource-exhausted') {
        toast.error('Sistema temporariamente indisponível. Tente novamente em alguns minutos.');
      } else {
        toast.error('Erro ao solicitar corrida. Tente novamente.');
      }
    }
  };

  const handleCancelRide = async () => {
    if (!rideId) return;

    try {
      // Delete the ride from Firestore
      const rideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, rideId);
      await deleteDoc(rideRef);

      // Reset local state
      setOrigin(null);
      setDestination(null);
      setOriginQuery('');
      setDestinationQuery('');
      setSelectedCategory('');
      setSelectedPayment('pix');
      setRideId(null);
      setCurrentStep('location');

      // Navigate back to home
      navigate('/');
    } catch (error) {
      console.error('Erro ao cancelar corrida:', error);
    }
  };
  
  const handleSaveQuickDestination = async () => {
    if (!origin || !destination || !quickDestinationName.trim()) return;

    try {
      const quickDestRef = collection(db, 'quickDestinations');
      await addDoc(quickDestRef, {
        name: quickDestinationName.trim(),
        origin: {
          place: origin.place,
          address: origin.address,
          coordinates: origin.coordinates
        },
        destination: {
          place: destination.place,
          address: destination.address,
          coordinates: destination.coordinates
        },
        userId: user?.uid,
        icon: '📍',
        createdAt: Timestamp.now()
      });

      toast.success('Destino rápido salvo com sucesso!');
      setShowSaveModal(false);
      setQuickDestinationName('');
    } catch (error) {
      console.error('Erro ao salvar destino rápido:', error);
      toast.error('Erro ao salvar destino rápido');
    }
  };
  
  const renderLocationStep = () => (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-2xl font-bold font-heading">Para onde vamos?</h1>
      
      <div className="space-y-4">
        {/* Origin input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
              <MapPin size={16} className="text-primary-600" />
            </div>
          </div>
          <input
            id="origin-input"
            type="text"
            className="input pl-12"
            placeholder="Rua e número (ex: Rua Cristiano Victor, 123)"
            value={origin ? origin.place : originQuery}
            onChange={(e) => setOriginQuery(e.target.value)}
            readOnly={!!origin}
            autoFocus
          />
          {origin && (
            <button 
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              onClick={() => handleResetLocation('origin')}
            >
              <X size={18} />
            </button>
          )}
        </div>
        
        {/* Destination input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div className="w-6 h-6 rounded-full bg-secondary-100 flex items-center justify-center">
              <Navigation size={16} className="text-secondary-600" />
            </div>
          </div>
          <input
            id="destination-input"
            type="text"
            className="input pl-12"
            placeholder="Rua e número (ex: Rua Principal, 456)"
            value={destination ? destination.place : destinationQuery}
            onChange={(e) => setDestinationQuery(e.target.value)}
            readOnly={!!destination}
            disabled={!origin}
          />
          {destination && (
            <button 
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
              onClick={() => handleResetLocation('destination')}
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      
      {/* Search results */}
      {((!origin && originQuery.length > 2) || (origin && !destination && destinationQuery.length > 2)) && (
        <div className="bg-white rounded-lg shadow-lg border border-gray-100 overflow-hidden animate-slide-up">
          {isSearching ? (
            <div className="p-4 text-center">
              <div className="animate-pulse flex space-x-4 items-center justify-center">
                <div className="rounded-full bg-gray-200 h-10 w-10"></div>
                <div className="flex-1 space-y-4 py-1 max-w-xs">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              Nenhum resultado encontrado
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {searchResults.map(result => (
                <li key={result.id}>
                  <button
                    className="p-4 w-full text-left hover:bg-gray-50 flex items-start"
                    onClick={() => handleSelectLocation(result)}
                  >
                    <MapPin size={20} className="text-gray-400 mr-3 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">{result.place}</p>
                      <p className="text-sm text-gray-500">{result.address}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      
      {/* Map */}
      <div className="h-[calc(100vh-32rem)] min-h-[300px] rounded-lg overflow-hidden">
        <Map
          className="w-full h-full"
          origin={origin?.coordinates}
          destination={destination?.coordinates}
          showRoute={!!(origin && destination)}
          driverLocation={driver?.currentLocation || undefined}
          autoUpdate={!!driver}
        />
      </div>

      {/* Botões de ação */}
      <div className="space-y-3">
        {origin && destination && (
          <>
            <button
              className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors flex items-center justify-center"
              onClick={() => setCurrentStep('categories')}
            >
              Confirmar endereços
              <ChevronRight size={20} className="ml-2" />
            </button>

            <button
              className="w-full bg-white border border-primary-600 text-primary-600 py-3 rounded-lg font-medium hover:bg-primary-50 transition-colors flex items-center justify-center"
              onClick={() => setShowSaveModal(true)}
            >
              Salvar como destino rápido
              <Star size={20} className="ml-2" />
            </button>
          </>
        )}
      </div>

      {/* Modal para salvar destino rápido */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h2 className="text-xl font-bold">Salvar destino rápido</h2>
            
            <div className="space-y-2">
              <label htmlFor="quick-dest-name" className="block text-sm font-medium text-gray-700">
                Nome do destino
              </label>
              <input
                id="quick-dest-name"
                type="text"
                className="input"
                placeholder="Ex: Casa, Trabalho, Academia"
                value={quickDestinationName}
                onChange={(e) => setQuickDestinationName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex items-start space-x-3">
                <MapPin size={18} className="text-gray-500 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Origem</p>
                  <p className="font-medium">{origin?.place}</p>
                  <p className="text-sm text-gray-500">{origin?.address}</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Navigation size={18} className="text-gray-500 mt-0.5" />
                <div>
                  <p className="text-sm text-gray-500">Destino</p>
                  <p className="font-medium">{destination?.place}</p>
                  <p className="text-sm text-gray-500">{destination?.address}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowSaveModal(false);
                  setQuickDestinationName('');
                }}
                className="flex-1 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveQuickDestination}
                className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
                disabled={!quickDestinationName.trim()}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sponsors */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 -mt-2">
        <h3 className="text-sm font-medium text-gray-500 mb-4">Patrocinadores</h3>
        <div className="grid grid-cols-4 gap-3">
          {/* Example sponsors - replace with real sponsor data */}
          <div className="aspect-[4/2] bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="text-gray-400">Sponsor 1</span>
          </div>
          <div className="aspect-[4/2] bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="text-gray-400">Sponsor 2</span>
          </div>
          <div className="aspect-[4/2] bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="text-gray-400">Sponsor 3</span>
          </div>
          <div className="aspect-[4/2] bg-gray-100 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors cursor-pointer">
            <span className="text-gray-400">Sponsor 4</span>
          </div>
        </div>
      </div>
    </div>
  );
  
  const renderCategoriesStep = () => (
    <div className="space-y-3">
      <div className="flex items-center mb-3">
        <button 
          onClick={() => setCurrentStep('location')}
          className="mr-4 p-2 rounded-full hover:bg-gray-100"
        >
          <X size={20} className="text-gray-500" />
        </button>
        <h1 className="text-2xl font-bold font-heading">Escolha o tipo de veículo</h1>
      </div>
      
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="space-y-3">
          <div className="flex items-center text-sm text-gray-600">
            <MapPin size={16} className="mr-1" />
            <span className="truncate">{origin?.place}</span>
          </div>
          <div className="flex items-center text-sm text-gray-600">
            <Navigation size={16} className="mr-1" />
            <span className="truncate">{destination?.place}</span>
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse">
              <div className="w-full h-24 bg-gray-100 rounded-lg"></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {categories.map(category => (
              <button
                key={category.id}
                className={`w-full bg-white p-4 rounded-lg border transition-all flex items-center justify-between ${
                  selectedCategory === category.id 
                    ? 'border-primary-500 bg-primary-50 shadow-md' 
                    : 'border-gray-200 hover:border-primary-300 hover:shadow-md'
                }`}
                onClick={() => handleSelectCategory(category.id)}
              >
                <div className="flex items-center">
                  <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mr-4">
                    <Car size={24} className="text-gray-700" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-medium text-gray-900">{category.name}</h3>
                    <p className="text-sm text-gray-500">{category.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">R$ {category.estimatedPrice?.toFixed(2) || ''}</p>
                  <p className="text-sm text-gray-500">{category.estimatedTime || ''}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Payment Methods */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-3">Formas de Pagamento</h3>
            <div className="space-y-3">
              <button 
                onClick={() => setSelectedPayment('pix')}
                className={`w-full flex items-center p-3 border rounded-lg hover:bg-gray-50 transition-colors ${
                  selectedPayment === 'pix' ? 'border-green-500 bg-green-50' : ''
                }`}
              >
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center mr-3">
                  <span className="text-green-600 font-bold text-sm">PIX</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Pix</p>
                  <p className="text-sm text-gray-500">Pagamento instantâneo</p>
                </div>
              </button>

              <button 
                onClick={() => setSelectedPayment('card')}
                className={`w-full flex items-center p-3 border rounded-lg hover:bg-gray-50 transition-colors ${
                  selectedPayment === 'card' ? 'border-blue-500 bg-blue-50' : ''
                }`}
              >
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                  <CreditCard size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Cartão</p>
                  <p className="text-sm text-gray-500">Crédito ou débito</p>
                </div>
              </button>

              <button 
                onClick={() => setSelectedPayment('cash')}
                className={`w-full flex items-center p-3 border rounded-lg hover:bg-gray-50 transition-colors ${
                  selectedPayment === 'cash' ? 'border-yellow-500 bg-yellow-50' : ''
                }`}
              >
                <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center mr-3">
                  <span className="text-yellow-600 font-bold">R$</span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">Dinheiro</p>
                  <p className="text-sm text-gray-500">Pagamento em espécie</p>
                </div>
              </button>
            </div>
          </div>

          {/* Confirm Button */}
          <button
            className="btn-primary w-full flex items-center justify-center"
            onClick={() => {
              if (selectedCategory && selectedPayment) {
                setCurrentStep('confirmation');
              }
            }}
            disabled={!selectedCategory || !selectedPayment}
          >
            Continuar
            <ChevronRight size={20} className="ml-2" />
          </button>
        </>
      )}
    </div>
  );
  
  const renderConfirmationStep = () => {
    const selectedVehicle = categories.find(c => c.id === selectedCategory);
    if (!selectedVehicle) return null;
    
    const formatDistance = (distance: number) => {
      // Garantir que a distância está em metros
      const distanceInMeters = distance;
      if (distanceInMeters < 1000) {
        return `${Math.round(distanceInMeters)} m`;
      }
      return `${(distanceInMeters / 1000).toFixed(1)} km`;
    };

    const formatDuration = (duration: string) => {
      // Convert duration from string to seconds
      const seconds = Math.round(parseFloat(duration) / 1000);
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    };

    return (
      <div className="space-y-3">
        {/* Route info */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-start">
            <div className="mr-4 flex flex-col items-center">
              <div className="w-3 h-3 rounded-full bg-primary-500"></div>
              <div className="w-0.5 h-10 bg-gray-200 my-1"></div>
              <div className="w-3 h-3 rounded-full bg-secondary-500"></div>
            </div>
            <div className="space-y-4 flex-1">
              <div>
                <p className="font-medium truncate">{origin?.place}</p>
                <p className="text-sm text-gray-500 truncate">{origin?.address}</p>
              </div>
              <div>
                <p className="font-medium truncate">{destination?.place}</p>
                <p className="text-sm text-gray-500 truncate">{destination?.address}</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Vehicle info */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center mb-3">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mr-4">
              <Car size={24} className="text-gray-700" />
            </div>
            <div>
              <h3 className="font-medium">{selectedVehicle.name}</h3>
              <p className="text-sm text-gray-500">{selectedVehicle.description}</p>
            </div>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex items-center text-gray-600">
              <UserCheck size={16} className="mr-2" />
              <span>Motoristas verificados</span>
            </div>
            <div className="flex items-center text-gray-600">
              <ShieldCheck size={16} className="mr-2" />
              <span>Viagem protegida</span>
            </div>
          </div>
        </div>
        
        {/* Payment Method */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="font-medium text-gray-900 mb-3">Forma de Pagamento</h3>
          <div className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
              selectedPayment === 'pix' ? 'bg-green-100' :
              selectedPayment === 'card' ? 'bg-blue-100' :
              'bg-yellow-100'
            }`}>
              {selectedPayment === 'pix' && <span className="text-green-600 font-bold text-sm">PIX</span>}
              {selectedPayment === 'card' && <CreditCard size={16} className="text-blue-600" />}
              {selectedPayment === 'cash' && <span className="text-yellow-600 font-bold">R$</span>}
            </div>
            <div>
              <p className="font-medium text-gray-900">
                {selectedPayment === 'pix' ? 'Pix' :
                 selectedPayment === 'card' ? 'Cartão' :
                 'Dinheiro'}
              </p>
              <p className="text-sm text-gray-500">
                {selectedPayment === 'pix' ? 'Pagamento instantâneo' :
                 selectedPayment === 'card' ? 'Crédito ou débito' :
                 'Pagamento em espécie'}
              </p>
            </div>
          </div>
        </div>
        
        {/* Price and confirmation */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-gray-500">Valor estimado</p>
              <p className="text-2xl font-bold">R$ {selectedVehicle.estimatedPrice?.toFixed(2) || ''}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">Tempo estimado</p>
              <p className="font-medium">{selectedVehicle.estimatedTime || ''}</p>
            </div>
          </div>
        </div>
        
        <button
          className="btn-primary w-full flex items-center justify-center"
          onClick={handleConfirmRide}
        >
          Confirmar corrida
          <ChevronRight size={20} className="ml-2" />
        </button>
      </div>
    );
  };

  // Atualizar monitoramento de corrida
  useEffect(() => {
    if (!rideId) return;

    console.log('Iniciando monitoramento da corrida:', rideId);

    // Usar um único listener para monitorar a corrida
    const unsubscribe = onSnapshot(
      doc(db, COLLECTIONS.ACTIVE_RIDES, rideId),
      { includeMetadataChanges: false },
      async (snapshot) => {
        if (!snapshot.exists()) {
          // Se a corrida não existe em active_rides, verificar em completed_rides
          try {
            const completedRideDoc = await getDoc(doc(db, COLLECTIONS.COMPLETED_RIDES, rideId));
            if (completedRideDoc.exists()) {
              const completedRideData = { id: completedRideDoc.id, ...completedRideDoc.data() } as Ride;
              setRide(completedRideData);
              if (completedRideData.status === 'completed') {
                setShowRatingModal(true);
              }
              if (completedRideData.driver) {
                setDriver(completedRideData.driver);
              }
            } else {
              // Se não existir em nenhum lugar, voltar para home
              toast.success('Corrida finalizada');
              navigate('/');
            }
          } catch (error) {
            console.error('Erro ao verificar corrida completada:', error);
          }
          return;
        }

        const rideData = { id: snapshot.id, ...snapshot.data() } as Ride;
        setRide(rideData);
        
        if (rideData.driver) {
          setDriver(rideData.driver);
        }

        if (rideData.status === 'completed') {
          setShowRatingModal(true);
          toast.success('Você chegou ao seu destino! 🎉');
        }

        // Quando um motorista aceitar a corrida
        if (rideData.status === 'accepted' && rideData.driver) {
          sendNotification('Motorista encontrado! 🚗', {
            body: `${rideData.driver.name} está a caminho do seu local`,
            icon: '/car-icon.png'
          });
        }

        // Quando o motorista chegar ao local
        if (rideData.driverArrived) {
          sendNotification('Motorista chegou! 📍', {
            body: 'Seu motorista chegou ao local de origem',
            icon: '/location-icon.png'
          });
        }
      }
    );

    return () => {
      console.log('Parando monitoramento da corrida');
      unsubscribe();
    };
  }, [rideId, navigate]);

  const handleSubmitRating = async () => {
    if (!ride || !ride.driver) return;

    try {
      console.log('Enviando avaliação para a corrida:', ride.id);
      
      // Primeiro, atualizar apenas a avaliação da corrida
      const rideRef = doc(db, COLLECTIONS.COMPLETED_RIDES, ride.id);
      await updateDoc(rideRef, {
        rating,
        ratingComment,
        ratedAt: Timestamp.now()
      });

      console.log('Avaliação da corrida salva com sucesso');

      try {
        // Em uma segunda operação, tentar atualizar a avaliação do motorista
        const driverRef = doc(db, 'drivers', ride.driver.id);
        const driverDoc = await getDoc(driverRef);
        
        if (driverDoc.exists()) {
          const driverData = driverDoc.data();
          const totalRatings = driverData.totalRatings || 0;
          const currentRating = driverData.rating || 5;
          
          const newRating = ((currentRating * totalRatings) + rating) / (totalRatings + 1);
          
          await updateDoc(driverRef, {
            rating: newRating,
            totalRatings: totalRatings + 1
          });

          console.log('Avaliação do motorista atualizada');
        }
      } catch (driverError) {
        // Se houver erro ao atualizar o motorista, apenas logar o erro
        // mas não impedir o fluxo principal
        console.error('Erro ao atualizar avaliação do motorista:', driverError);
      }

      setShowRatingModal(false);
      toast.success('Obrigado pela sua avaliação!');
      // Pequeno delay antes de navegar para garantir que o usuário veja o toast
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (error) {
      console.error('Erro ao enviar avaliação:', error);
      toast.error('Erro ao enviar avaliação. Tente novamente.');
    }
  };

  // Se tiver uma corrida completa e showRatingModal for true, mostrar apenas o modal
  if (showRatingModal && ride?.status === 'completed') {
    console.log('Exibindo modal de avaliação para a corrida:', ride.id);
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
        <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4 m-4">
          <h2 className="text-2xl font-bold text-center">Como foi sua viagem?</h2>
          
          {/* Informações do motorista */}
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              <UserIcon className="w-8 h-8 text-gray-600" />
            </div>
            <div>
              <h3 className="font-medium text-lg">{ride.driver?.name}</h3>
              <p className="text-gray-500">{ride.driver?.vehicle.model} • {ride.driver?.vehicle.plate}</p>
            </div>
          </div>

          {/* Estrelas para avaliação */}
          <div className="flex justify-center space-x-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className={`text-3xl ${rating >= star ? 'text-yellow-400' : 'text-gray-300'}`}
              >
                ★
              </button>
            ))}
          </div>

          {/* Campo de comentário */}
          <textarea
            className="w-full p-3 border rounded-lg resize-none"
            placeholder="Deixe um comentário sobre sua viagem (opcional)"
            rows={3}
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
          />

          {/* Botões */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowRatingModal(false);
                navigate('/');
              }}
              className="flex-1 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Pular
            </button>
            <button
              onClick={handleSubmitRating}
              className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Avaliar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Renderizar modal de avaliação
  const renderRatingModal = () => {
    if (!ride?.driver) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
        <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
          <h2 className="text-2xl font-bold text-center">Como foi sua viagem?</h2>
          
          {/* Informações do motorista */}
          <div className="flex items-center space-x-4 mb-6">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
              <UserIcon className="w-8 h-8 text-gray-600" />
            </div>
            <div>
              <h3 className="font-medium text-lg">{ride.driver.name}</h3>
              <p className="text-gray-500">{ride.driver.vehicle.model} • {ride.driver.vehicle.plate}</p>
            </div>
          </div>

          {/* Estrelas para avaliação */}
          <div className="flex justify-center space-x-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className={`text-3xl ${rating >= star ? 'text-yellow-400' : 'text-gray-300'}`}
              >
                ★
              </button>
            ))}
          </div>

          {/* Campo de comentário */}
          <textarea
            className="w-full p-3 border rounded-lg resize-none"
            placeholder="Deixe um comentário sobre sua viagem (opcional)"
            rows={3}
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
          />

          {/* Botões */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowRatingModal(false)}
              className="flex-1 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Pular
            </button>
            <button
              onClick={handleSubmitRating}
              className="flex-1 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Avaliar
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render driver info and map
  const renderDriverInfo = (driver: DriverType) => {
    console.log('Renderizando dados do motorista:', driver);
    
    return (
      <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 p-6">
        {/* Cabeçalho com nome e avaliação */}
        <div className="flex items-center mb-6">
          <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4">
            <UserIcon className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">{driver.name}</h2>
            <div className="flex items-center">
              <Star className="text-yellow-400 fill-current w-4 h-4 mr-1" />
              <span className="text-gray-600">{driver.rating?.toFixed(1) || ''}</span>
            </div>
          </div>
        </div>

        {/* Informações do veículo */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-center mb-4">
            <Car className="text-gray-500 w-5 h-5 mr-2" />
            <h3 className="font-medium text-gray-900">Veículo</h3>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500">Modelo:</span>
              <span className="font-medium text-gray-900">{driver.vehicle?.model}</span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-gray-500">Placa:</span>
              <span className="font-medium text-gray-900">{driver.vehicle?.plate}</span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Cor:</span>
              <div className="flex items-center">
                <div 
                  className="w-4 h-4 rounded-full mr-2 border border-gray-200" 
                  style={{ backgroundColor: driver.vehicle?.color }}
                />
                <span className="font-medium text-gray-900 capitalize">
                  {driver.vehicle?.color}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Informações de contato */}
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex items-center mb-4">
            <Phone className="text-gray-500 w-5 h-5 mr-2" />
            <h3 className="font-medium text-gray-900">Contato</h3>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Telefone:</span>
            <span className="font-medium text-gray-900">{driver.phone}</span>
          </div>
        </div>

        {/* Botão de ligar */}
        <div className="mt-4">
          <a
            href={`tel:${driver.phone}`}
            className="w-full bg-primary-600 text-white py-3 rounded-lg flex items-center justify-center font-medium hover:bg-primary-700 transition-colors"
          >
            <Phone className="w-5 h-5 mr-2" />
            Ligar para motorista
          </a>
        </div>

        {/* Mapa em tamanho maior */}
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 overflow-hidden mt-4" style={{ height: '300px' }}>
          <Map
            className="w-full h-full"
            origin={undefined}
            destination={undefined}
            showRoute={false}
            driverLocation={undefined}
            autoUpdate={true}
          />
        </div>
      </div>
    );
  };

  // Render driver info and status
  if (driver) {
    return (
      <>
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 p-4 mb-4">
          <div className="flex items-center mb-4">
            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4">
              <UserIcon className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{driver.name}</h2>
              <div className="flex items-center">
                <Star className="text-yellow-400 fill-current w-4 h-4 mr-1" />
                <span className="text-gray-600">{driver.rating?.toFixed(1) || ''}</span>
              </div>
            </div>
          </div>

          {/* Informações do veículo */}
          <div className="flex items-center mb-4">
            <Car className="text-gray-500 w-5 h-5 mr-2" />
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Veículo:</span>
                <span className="font-medium">{driver.vehicle?.model} • {driver.vehicle?.plate}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Cor:</span>
                <span className="font-medium">{driver.vehicle?.color}</span>
              </div>
            </div>
          </div>

          {/* Botão de ligar */}
          <a
            href={`tel:${driver.phone}`}
            className="w-full bg-primary-600 text-white py-2 rounded-lg flex items-center justify-center font-medium hover:bg-primary-700 transition-colors"
          >
            <Phone className="w-4 h-4 mr-2" />
            Ligar para motorista
          </a>
        </div>

        {/* Mapa em tamanho maior */}
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 overflow-hidden" style={{ height: '400px' }}>
          <Map
            className="w-full h-full"
            origin={driver.currentLocation || undefined}
            destination={origin?.coordinates}
            showRoute={!!driver}
            driverLocation={driver.currentLocation || undefined}
            autoUpdate={true}
          />
        </div>

        {/* Status do motorista */}
        <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 p-4 mt-4">
          <div className="flex items-center text-primary-600">
            <Navigation className="w-5 h-5 mr-2" />
            <span className="font-medium">Motorista a caminho</span>
          </div>
        </div>
      </>
    );
  }

  // Render searching state page
  if (rideId) {
    return (
      <div className="fixed inset-0 flex flex-col bg-white">
        <div className="flex-1 relative">
          {/* Map em tela cheia como background */}
          <div className="absolute inset-0">
            <Map
              className="w-full h-full"
              origin={driver?.currentLocation || undefined}
              destination={origin?.coordinates}
              showRoute={!!driver}
              driverLocation={driver?.currentLocation || undefined}
              autoUpdate={true}
            />
          </div>

          {/* Conteúdo sobreposto ao mapa */}
          <div className="absolute inset-x-0 top-0 p-4 space-y-4 max-w-lg mx-auto">
            {driver ? (
              <>
                {renderDriverInfo(driver)}
                <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 p-4">
                  <div className="flex items-center text-primary-600">
                    <Navigation className="w-5 h-5 mr-2" />
                    <span className="font-medium">Motorista a caminho</span>
                  </div>
                </div>
                {/* Mapa para mostrar localização do motorista */}
                <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 overflow-hidden" style={{ height: '300px' }}>
                  <Map
                    className="w-full h-full"
                    origin={driver?.currentLocation}
                    destination={origin?.coordinates}
                    showRoute={!!driver}
                    driverLocation={driver?.currentLocation}
                    autoUpdate={true}
                  />
                </div>
              </>
            ) : (
              <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 p-6 text-center">
                <div className="relative w-16 h-16 mx-auto mb-4">
                  <div className="absolute inset-0 bg-primary-100 rounded-full animate-ping opacity-75"></div>
                  <div className="relative flex items-center justify-center w-16 h-16 bg-primary-500 rounded-full">
                    <Car size={32} className="text-white" />
                  </div>
                </div>
                <h2 className="text-xl font-semibold mb-2">Procurando motorista próximo</h2>
                <div className="flex items-center justify-center text-gray-600">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Botão de cancelar fixo na parte inferior */}
          <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-white via-white/90 to-transparent">
            <div className="max-w-lg mx-auto">
              <button
                onClick={handleCancelRide}
                className="w-full bg-red-50 text-red-600 py-4 px-4 rounded-lg font-medium hover:bg-red-100 transition-colors shadow-lg"
              >
                Cancelar corrida
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Regular flow
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto bg-white">
        {/* Header */}
        <header className="px-4 py-3 border-b">
          <button 
            onClick={() => navigate(-1)} 
            className="text-gray-600 hover:text-gray-900"
          >
            <X size={24} />
          </button>
        </header>

        {/* Content */}
        <div className="p-4">
          {currentStep === 'location' && renderLocationStep()}
          {currentStep === 'categories' && renderCategoriesStep()}
          {currentStep === 'confirmation' && renderConfirmationStep()}
        </div>
      </div>
      {/* Sempre renderizar o modal se showRatingModal for true */}
      {showRatingModal && renderRatingModal()}
    </div>
  );
};

// Função para calcular preço estimado
const calculateEstimatedPrice = (category: VehicleCategory) => {
  if (!origin || !destination) return 0;
  
  // Calcular distância em km (pode ser melhorado com a distância real da rota)
  const distance = calculateDistance(
    origin.coordinates[0],
    origin.coordinates[1],
    destination.coordinates[0],
    destination.coordinates[1]
  );
  
  // Calcular preço base
  let price = category.basePrice + (distance * category.pricePerKm);
  
  // Aplicar multiplicador de chuva se estiver chovendo (exemplo)
  const isRaining = false; // Você pode implementar uma verificação real do clima
  if (isRaining) {
    price *= category.dynamicPricing.rainMultiplier;
  }
  
  // Verificar se é horário de pico
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  const isPeakHour = category.dynamicPricing.peakHours.some(period => {
    return currentTime >= period.start && currentTime <= period.end;
  });
  
  if (isPeakHour) {
    price *= category.dynamicPricing.peakHoursMultiplier;
  }
  
  // Garantir preço mínimo
  return Math.max(price, category.minPrice);
};

// Função para calcular distância entre dois pontos (Haversine)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Raio da Terra em km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distância em km
};

const toRad = (value: number) => {
  return (value * Math.PI) / 180;
};

// Função para calcular tempo estimado
const calculateEstimatedTime = () => {
  if (!origin || !destination) return "0 min";
  
  // Calcular distância
  const distance = calculateDistance(
    origin.coordinates[0],
    origin.coordinates[1],
    destination.coordinates[0],
    destination.coordinates[1]
  );
  
  // Assumir velocidade média de 30 km/h
  const averageSpeed = 30;
  const timeInHours = distance / averageSpeed;
  const timeInMinutes = Math.ceil(timeInHours * 60);
  
  return `${timeInMinutes} min`;
};

export default RideRequest;
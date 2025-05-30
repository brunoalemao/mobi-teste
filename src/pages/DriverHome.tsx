import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp, getDoc, getDocs, addDoc, deleteDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db, COLLECTIONS } from '../utils/firebase';
import { MapPin, Clock, User as UserIcon, DollarSign, Car, Star, Route, CreditCard, CheckCircle, TrendingUp, X, Bell, Power } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { calculateDistance, getCurrentLocation } from '../utils/mapbox';
import Map from '../components/Map';
import { Ride, Driver } from '../types/user';
import { sendNotification } from '../utils/notifications';

const DriverHome = () => {
  const { user } = useAuth();
  const [availableRides, setAvailableRides] = useState<Ride[]>([]);
  const [myRides, setMyRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(0);
  const [showPickupRoute, setShowPickupRoute] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const mountedRef = useRef(true);
  const locationAttempts = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Verificar status do motorista
  useEffect(() => {
    if (!user) {
      console.log('🚫 Sem usuário logado');
      setLoading(false);
      return;
    }

    console.log('🔄 Iniciando monitoramento de status para:', user.uid);

    // Listener para status do motorista
    const unsubscribe = onSnapshot(
      doc(db, 'drivers', user.uid),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data();
          const status = Boolean(data.isOnline);
          console.log('📡 Status recebido do Firestore:', {
            raw: data.isOnline,
            converted: status,
            lastUpdate: data.lastUpdate?.toDate(),
            driverId: user.uid
          });
          setIsOnline(status);
        } else {
          console.log('⚠️ Documento do motorista não encontrado');
        }
        setLoading(false);
      },
      (error) => {
        console.error('❌ Erro ao monitorar status:', error);
        setLoading(false);
      }
    );

    // Verificar status inicial diretamente
    getDoc(doc(db, 'drivers', user.uid)).then(docSnap => {
      if (docSnap.exists()) {
        console.log('🔍 Status inicial:', {
          isOnline: docSnap.data().isOnline,
          lastUpdate: docSnap.data().lastUpdate?.toDate()
        });
      }
    });

    return () => {
      console.log('🔄 Removendo listener de status');
      unsubscribe();
    };
  }, [user]);

  // Função para alternar estado online/offline
  const toggleOnlineStatus = async () => {
    if (!user || isProcessing) {
      console.log('🚫 Toggle bloqueado:', { isProcessing, hasUser: !!user });
      return;
    }
    
    setIsProcessing(true);
    const newStatus = !isOnline;
    console.log('🔄 Tentando alterar status:', {
      de: isOnline,
      para: newStatus,
      userId: user.uid
    });

    try {
      const driverRef = doc(db, 'drivers', user.uid);
      const updateData = {
        isOnline: newStatus,
        lastUpdate: Timestamp.now()
      };

      console.log('📝 Atualizando documento:', {
        ref: driverRef.path,
        data: updateData
      });

      await updateDoc(driverRef, updateData);

      console.log('✅ Status atualizado com sucesso');

      // Limpar corridas se ficar offline
      if (!newStatus) {
        console.log('🧹 Limpando corridas disponíveis');
        setAvailableRides([]);
      }

      toast.success(newStatus ? 'Você está online!' : 'Você está offline');
    } catch (error) {
      console.error('❌ Erro ao atualizar status:', error);
      toast.error('Erro ao atualizar status');

      // Verificar estado atual no Firestore
      try {
        const currentDoc = await getDoc(doc(db, 'drivers', user.uid));
        if (currentDoc.exists()) {
          console.log('🔍 Estado atual no Firestore:', {
            isOnline: currentDoc.data().isOnline,
            lastUpdate: currentDoc.data().lastUpdate?.toDate()
          });
        }
      } catch (verifyError) {
        console.error('❌ Erro ao verificar estado atual:', verifyError);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Log quando o estado local muda
  useEffect(() => {
    console.log('🔄 Estado local alterado:', {
      isOnline,
      timestamp: new Date().toISOString()
    });
  }, [isOnline]);

  // Função para obter localização com fallback
  const getLocationWithFallback = async (): Promise<[number, number]> => {
    try {
      const coords = await getCurrentLocation();
      return coords;
    } catch (error) {
      console.error('❌ Erro ao obter localização precisa:', error);
      
      // Fallback para última localização conhecida no Firestore
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.currentLocation) {
              console.log('📍 Usando última localização conhecida do Firestore');
              return userData.currentLocation as [number, number];
            }
          }
        } catch (fbError) {
          console.error('❌ Erro ao buscar localização do Firestore:', fbError);
        }
      }

      // Fallback para uma localização padrão (centro da cidade)
      console.log('📍 Usando localização padrão');
      return [-16.3285, -48.9535]; // Coordenadas do centro de Goiânia
    }
  };

  // Obter localização atual do motorista
  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const loadCurrentLocation = async () => {
      try {
        console.log('📍 Tentando obter localização atual...');
        locationAttempts.current += 1;

        const coords = await getLocationWithFallback();
        if (mountedRef.current) {
          console.log('📍 Localização obtida:', coords);
        setCurrentLocation(coords);
          setLocationError(null);
          locationAttempts.current = 0;
        }
      } catch (error) {
        console.error('❌ Erro ao obter localização:', error);
        if (mountedRef.current) {
          setLocationError('Erro ao obter localização');
          // Se falhar 3 vezes, continuar com a localização padrão
          if (locationAttempts.current >= 3) {
            console.log('📍 Usando localização padrão após várias tentativas');
            setCurrentLocation([-16.3285, -48.9535]);
          }
        }
      }
    };

    loadCurrentLocation();
    intervalId = setInterval(loadCurrentLocation, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [user]);

  const handleNotifyArrival = async () => {
    if (!selectedRide) return;

    try {
      const rideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, selectedRide.id!);
      await updateDoc(rideRef, {
        driverArrived: true
      });

      setShowPickupRoute(false);

      toast.success('Passageiro notificado da sua chegada!', {
        icon: '✅'
      });
    } catch (error) {
      console.error('Erro ao notificar chegada:', error);
      toast.error('Erro ao notificar passageiro');
    }
  };

  const handleStartRide = async (ride: Ride) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const loadingToast = toast.loading('Iniciando corrida...');
      
      const rideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, ride.id);
      await updateDoc(rideRef, {
        status: 'inProgress',
        startedAt: Timestamp.now()
      });

      setSelectedRide({ ...ride, status: 'inProgress' });
      setShowPickupRoute(false);
      setShowRouteMap(true);

      toast.dismiss(loadingToast);
      toast.success('Corrida iniciada!');
    } catch (error) {
      console.error('Erro ao iniciar corrida:', error);
      toast.error('Erro ao iniciar corrida. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompleteRide = async (ride: Ride) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const loadingToast = toast.loading('Finalizando corrida...');

      // Mover a corrida para completedRides usando o mesmo ID
      const completedRideRef = doc(db, COLLECTIONS.COMPLETED_RIDES, ride.id);
      await setDoc(completedRideRef, {
        ...ride,
        status: 'completed',
        completedAt: Timestamp.now(),
        completedBy: user?.uid,
        finalLocation: currentLocation
      });

      // Remover da coleção activeRides
      const activeRideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, ride.id);
      await deleteDoc(activeRideRef);

      setMyRides(current => current.filter(r => r.id !== ride.id));
      setSelectedRide(null);
      setShowRouteMap(false);
      setShowPickupRoute(true);

      toast.dismiss(loadingToast);
      toast.success('Corrida finalizada com sucesso!');
    } catch (error) {
      console.error('Erro ao finalizar corrida:', error);
      toast.error('Erro ao finalizar corrida. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Memoizar o renderização do mapa
  const renderFullScreenMap = useCallback(() => {
    if (!showRouteMap || !selectedRide) return null;

    // Memoizar as coordenadas para evitar re-renders desnecessários
    const origin = showPickupRoute ? (currentLocation || undefined) : selectedRide.origin?.coordinates;
    const destination = showPickupRoute ? selectedRide.origin?.coordinates : selectedRide.destination?.coordinates;

    return (
      <div className="fixed inset-0 bg-white z-50">
        <div className="bg-white shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <button 
                onClick={() => {
                  setShowRouteMap(false);
                  if (selectedRide.status === 'accepted') {
                    setShowPickupRoute(true);
                  }
                }}
                className="mr-4 p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={24} className="text-gray-600" />
              </button>
              <div>
                <h2 className="text-lg font-semibold">
                  {showPickupRoute ? 'Rota até o passageiro' : 'Rota até o destino'}
                </h2>
                <p className="text-sm text-gray-500">
                  {showPickupRoute 
                    ? selectedRide.origin?.address 
                    : selectedRide.destination?.address}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {selectedRide.status === 'accepted' && (
                <>
                  <button
                    onClick={() => handleNotifyArrival()}
                    className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 flex items-center"
                  >
                    <Bell size={20} className="mr-2" />
                    Avisar Chegada
                  </button>
                  <button
                    onClick={() => handleStartRide(selectedRide)}
                    className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 flex items-center"
                  >
                    <Car size={20} className="mr-2" />
                    Iniciar Corrida
                  </button>
                </>
              )}
              {selectedRide.status === 'inProgress' && (
                <button
                  onClick={() => handleCompleteRide(selectedRide)}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium flex items-center justify-center"
                >
                  <CheckCircle size={20} className="mr-2" />
                  Finalizar Corrida
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="h-[calc(100vh-72px)]">
          <Map
            key={`${origin}-${destination}-${showPickupRoute}`}
            className="w-full h-full"
            origin={origin}
            destination={destination}
            showRoute={true}
            driverLocation={currentLocation || undefined}
            autoUpdate={false}
          />
        </div>
      </div>
    );
  }, [showRouteMap, selectedRide, currentLocation, showPickupRoute, handleNotifyArrival, handleStartRide, handleCompleteRide]);

  // Efeito principal para gerenciar corridas
  useEffect(() => {
    if (!user || !isOnline) {
      setAvailableRides([]);
      setLoading(false);
      return;
    }

    console.log('🔄 Iniciando configuração dos listeners...');

    let unsubscribeAvailable: () => void;
    let unsubscribeMyRides: () => void;

    const setupListeners = async () => {
      try {
        console.log('🔄 Configurando listeners de corridas...');

        // Listener para corridas disponíveis (apenas da coleção activeRides)
        const availableRidesQuery = query(
          collection(db, COLLECTIONS.ACTIVE_RIDES),
          where('status', '==', 'pending'),
          where('driverId', '==', null)
        );

        console.log('🔍 Query de corridas disponíveis:', {
          collection: COLLECTIONS.ACTIVE_RIDES,
          conditions: [
            { field: 'status', operator: '==', value: 'pending' },
            { field: 'driverId', operator: '==', value: null }
          ]
        });

        unsubscribeAvailable = onSnapshot(availableRidesQuery, (snapshot) => {
          if (!mountedRef.current) {
            console.log('❌ Componente desmontado, ignorando snapshot');
            return;
          }

          const rides = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Ride[];

          // Notificar sobre novas corridas disponíveis
          const newRides = rides.filter(ride => !availableRides.find(r => r.id === ride.id));
          if (newRides.length > 0) {
            newRides.forEach(ride => {
              sendNotification('Nova corrida disponível! 🚖', {
                body: `Origem: ${ride.origin.address}\nDestino: ${ride.destination.address}`,
                icon: '/new-ride-icon.png'
              });
            });
          }

          console.log('✅ Corridas disponíveis processadas:', rides.length);
          setAvailableRides(rides);
          setLoading(false);
        }, (error) => {
          console.error('❌ Erro no listener de corridas:', error);
          setError('Erro ao carregar corridas disponíveis');
          setLoading(false);
        });

        // Listener para minhas corridas ativas
        const myRidesQuery = query(
          collection(db, COLLECTIONS.ACTIVE_RIDES),
          where('driverId', '==', user.uid),
          where('status', 'in', ['accepted', 'inProgress'])
        );

        unsubscribeMyRides = onSnapshot(myRidesQuery, (snapshot) => {
          if (!mountedRef.current) return;

          const rides = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Ride[];

          console.log('🚗 Minhas corridas ativas:', rides.length);
          setMyRides(rides);
          setLoading(false);
        });

      } catch (error) {
        console.error('❌ Erro ao configurar listeners:', error);
        if (mountedRef.current) {
          setError('Erro ao carregar dados. Por favor, tente novamente.');
          setLoading(false);
        }
      }
    };

    setupListeners();

    return () => {
      console.log('🔄 Removendo listeners...');
      unsubscribeAvailable?.();
      unsubscribeMyRides?.();
    };
  }, [user, isOnline]);

  // Atualizar localização do motorista
  useEffect(() => {
    if (!user || !currentLocation || !mountedRef.current) return;

    const updateLocation = async () => {
      const now = Date.now();
      if (now - lastUpdateTime < 10000) return;

      try {
        // Atualizar localização na coleção users
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          currentLocation: currentLocation,
          lastLocationUpdate: Timestamp.now()
        });

        // Atualizar localização na coleção drivers
        const driverRef = doc(db, 'drivers', user.uid);
        await updateDoc(driverRef, {
          currentLocation: currentLocation,
          lastLocationUpdate: Timestamp.now()
        });
        
        if (mountedRef.current) {
          setLastUpdateTime(now);
        }
      } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        // Não mostrar erro para o usuário pois não é crítico
      }
    };

    updateLocation();
  }, [user, currentLocation, lastUpdateTime]);

  // Memoizar o cálculo de distâncias
  const updateDistances = useCallback(async () => {
      if (!currentLocation || availableRides.length === 0) return;

      const updatedRides = await Promise.all(
        availableRides.map(async (ride) => {
          try {
            if (!ride.origin.coordinates || !ride.destination.coordinates) {
              return ride;
            }

            const pickupDistance = await calculateDistance(
              currentLocation,
              ride.origin.coordinates
            );

            const rideDistance = await calculateDistance(
              ride.origin.coordinates,
              ride.destination.coordinates
            );

            if (pickupDistance && rideDistance) {
              return {
                ...ride,
                distanceToPickup: pickupDistance.distance,
                durationToPickup: pickupDistance.duration,
                distance: rideDistance.distance,
                duration: rideDistance.duration
              };
            }

            return ride;
          } catch (error) {
            console.error('Erro ao calcular distância para corrida:', ride.id, error);
            return ride;
          }
        })
      );

      setAvailableRides(updatedRides);
  }, [currentLocation, availableRides]);

  // Atualizar distâncias com debounce
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateDistances();
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [updateDistances]);

  // Função para atualizar estados com debounce
  const updateStatesWithDebounce = (rides: Ride[]) => {
    const now = Date.now();
    if (now - lastUpdateTime < 1000) { // Evitar atualizações em menos de 1 segundo
      return;
    }

    setLastUpdateTime(now);
    setAvailableRides(rides);
  };

  const handleAcceptRide = async (ride: Ride) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const loadingToast = toast.loading('Aceitando corrida...');

      const rideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, ride.id);
      const rideDoc = await getDoc(rideRef);
      
      if (!rideDoc.exists()) {
        toast.error('Esta corrida não está mais disponível');
        return;
      }

      const rideData = rideDoc.data();
      if (rideData.status !== 'pending' || rideData.driverId) {
        toast.error('Esta corrida já foi aceita por outro motorista');
        return;
      }

      const driverInfo = {
        id: user!.uid,
        name: user!.email?.split('@')[0] || 'Motorista',
        phone: '64992521789',
        rating: 5.0,
        vehicle: {
          model: 'Honda Civic',
          plate: 'ABC1234',
          color: 'Prata'
        },
        currentLocation: currentLocation || [0, 0]
      };

        await updateDoc(rideRef, {
          status: 'accepted',
        driverId: user!.uid,
          acceptedAt: Timestamp.now(),
          driver: driverInfo
        });

      setSelectedRide({
        ...ride,
        status: 'accepted',
        driver: driverInfo,
        driverId: user!.uid,
        acceptedAt: Timestamp.now()
      });
      setShowPickupRoute(true);
        setShowRouteMap(true);

      toast.dismiss(loadingToast);
        toast.success('Corrida aceita com sucesso!');
    } catch (error) {
      console.error('Erro ao aceitar corrida:', error);
      toast.error('Erro ao aceitar corrida. Tente novamente.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectRide = async (ride: Ride) => {
    try {
      const loadingToast = toast.loading('Recusando corrida...');

      // Mover para cancelledRides
      const cancelledRideRef = collection(db, COLLECTIONS.CANCELLED_RIDES);
      await addDoc(cancelledRideRef, {
        ...ride,
        status: 'cancelled',
        cancelledAt: Timestamp.now(),
        cancelledBy: 'driver',
        driverId: user?.uid
      });

      // Remover da coleção activeRides
      const activeRideRef = doc(db, COLLECTIONS.ACTIVE_RIDES, ride.id);
      await deleteDoc(activeRideRef);

      setAvailableRides(current => current.filter(r => r.id !== ride.id));
      
      if (selectedRide?.id === ride.id) {
        setSelectedRide(null);
        setShowRouteMap(false);
        setShowPickupRoute(true);
      }

      toast.dismiss(loadingToast);
      toast.success('Corrida recusada');
    } catch (error) {
      console.error('Erro ao recusar corrida:', error);
      toast.error('Erro ao recusar corrida. Tente novamente.');
    }
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(price);
  };

  const formatDistance = (distance: number) => {
    // Garantir que a distância está em metros
    const distanceInMeters = distance;
    if (distanceInMeters < 1000) {
      return `${Math.round(distanceInMeters)} m`;
    }
    return `${(distanceInMeters / 1000).toFixed(1)} km`;
  };

  const formatDuration = (duration: number) => {
    const minutes = Math.round(duration / 60);
    return `${minutes} min`;
  };

  const formatDistanceToPickup = (meters: number | undefined) => {
    if (!meters) return '-- km';
    // Garantir que a distância está em metros
    const distanceInMeters = meters;
    if (distanceInMeters < 1000) {
      return `${Math.round(distanceInMeters)} m`;
    }
    return `${(distanceInMeters / 1000).toFixed(1)} km`;
  };

  const formatDurationToPickup = (seconds: number | undefined) => {
    if (!seconds) return '-- min';
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <p className="text-red-600 text-center">{error}</p>
            </div>
            <button
          onClick={() => window.location.reload()}
              className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
            >
          Tentar Novamente
            </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mb-4"></div>
        <p className="text-gray-600">
          {!currentLocation ? 'Obtendo sua localização...' : 'Carregando...'}
        </p>
        {locationError && (
          <p className="text-yellow-600 text-sm mt-2">
            Tentando obter sua localização. Por favor, verifique as permissões de GPS.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4">
      {/* Corridas em andamento */}
      {myRides.length > 0 && (
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-4">Minhas Corridas em Andamento</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {myRides.map((ride) => (
              <div key={ride.id} className="bg-white rounded-lg shadow-md p-4">
                <div className="flex items-center gap-2 mb-3">
                  <UserIcon className="text-gray-500" size={20} />
                  <span className="font-medium">{ride.userName || 'Usuário'}</span>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div className="flex items-start gap-2">
                    <MapPin className="text-primary-600 mt-1" size={20} />
                    <div>
                      <p className="text-sm font-medium">Origem</p>
                      <p className="text-sm text-gray-600">{ride.origin?.address || 'Endereço não disponível'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-2">
                    <MapPin className="text-primary-600 mt-1" size={20} />
                    <div>
                      <p className="text-sm font-medium">Destino</p>
                      <p className="text-sm text-gray-600">{ride.destination?.address || 'Endereço não disponível'}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center">
                    <DollarSign className="mx-auto text-gray-500" size={20} />
                    <p className="text-sm font-medium">{formatPrice(ride.price || 0)}</p>
                  </div>
                  <div className="text-center">
                    <Car className="mx-auto text-gray-500" size={20} />
                    <p className="text-sm font-medium">{formatDistance(ride.distance || 0)}</p>
                  </div>
                  <div className="text-center">
                    <Clock className="mx-auto text-gray-500" size={20} />
                    <p className="text-sm font-medium">{formatDuration(ride.duration || 0)}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                {ride.status === 'accepted' && (
                    <>
                      <button
                        onClick={() => handleNotifyArrival()}
                        className="flex-1 bg-yellow-500 text-white py-3 px-4 rounded-lg hover:bg-yellow-600 flex items-center justify-center"
                      >
                        <Bell size={20} className="mr-2" />
                        Avisar Chegada
                      </button>
                  <button
                        onClick={() => {
                          setSelectedRide(ride);
                          setShowRouteMap(true);
                          handleStartRide(ride);
                        }}
                        className="flex-1 bg-primary-600 text-white py-3 px-4 rounded-lg hover:bg-primary-700 flex items-center justify-center"
                      >
                        <Car size={20} className="mr-2" />
                    Iniciar Corrida
                  </button>
                    </>
                )}

                {ride.status === 'inProgress' && (
                  <button
                    onClick={() => handleCompleteRide(ride)}
                      className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 flex items-center justify-center"
                  >
                      <CheckCircle size={20} className="mr-2" />
                    Finalizar Corrida
                  </button>
                )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Corridas disponíveis */}
      <div className="space-y-6 animate-fade-in">
        {/* Header com botão de online/offline */}
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Corridas Disponíveis</h1>
            <button
              onClick={toggleOnlineStatus}
              disabled={isProcessing}
              className={`flex items-center px-4 py-2 rounded-full transition-colors ${
                isOnline 
                  ? 'bg-green-500 text-white hover:bg-green-600' 
                  : 'bg-gray-500 text-white hover:bg-gray-600'
              }`}
            >
              <Power size={20} className="mr-2" />
              {isProcessing ? 'Atualizando...' : (isOnline ? 'Online' : 'Offline')}
            </button>
          </div>
        </div>

        {/* Status atual */}
        {!isOnline && (
          <div className="text-center py-8 text-gray-500">
            <Car size={48} className="mx-auto mb-4 text-gray-400" />
            <p>Você está offline. Fique online para receber corridas.</p>
          </div>
        )}

        {/* Lista de corridas disponíveis */}
        {isOnline && (
          <div className="space-y-4">
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
                <p className="mt-4 text-gray-500">Carregando corridas...</p>
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-500">
                <p>{error}</p>
              </div>
            ) : availableRides.length === 0 ? (
              <div className="text-center py-8">
                <Car size={48} className="mx-auto mb-4 text-gray-400" />
                <p className="text-gray-500">Nenhuma corrida disponível no momento</p>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {availableRides.map((ride) => (
                  <div key={ride.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                    {/* Cabeçalho com Preço */}
                    <div className="bg-white p-4 border-b">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          <UserIcon className="text-gray-600" size={20} />
                          <span className="font-medium">{ride.userName || 'Usuário'}</span>
                        </div>
                        <div>
                          <div className="flex items-center">
                            <span className="text-2xl font-bold">R$ {(ride.price || 0).toFixed(2)}</span>
                          </div>
                          <div className="text-xs text-gray-500 text-right">
                            +R$ {((ride.price || 0) * 0.2).toFixed(2)} incluído
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Corpo do Card */}
                    <div className="p-4 space-y-4">
                      {/* Distância e Tempo até o Passageiro */}
                      <div className="text-sm">
                        <div className="flex items-baseline space-x-2">
                          <span className="font-medium">{formatDistanceToPickup(ride.distanceToPickup)}</span>
                          <span className="text-gray-500">até o passageiro</span>
                          <span className="text-gray-500">•</span>
                          <span className="text-gray-500">{formatDurationToPickup(ride.durationToPickup)}</span>
                        </div>
                      </div>

                      {/* Endereços */}
                      <div className="relative pl-6">
                        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-200">
                          <div className="absolute top-0 h-2 w-2 -left-[3px] rounded-full bg-black"></div>
                          <div className="absolute bottom-0 h-2 w-2 -left-[3px] rounded-full bg-black"></div>
                        </div>
                        
                        <div className="space-y-4">
                          <div>
                            <p className="font-medium truncate">{ride.origin?.address || 'Endereço não disponível'}</p>
                            <p className="text-xs text-gray-500">Pegar passageiro</p>
                          </div>
                          <div>
                            <p className="font-medium truncate">{ride.destination?.address || 'Endereço não disponível'}</p>
                            <p className="text-xs text-gray-500">
                              Destino final • {formatDistance(ride.distance || 0)} • {formatDuration(ride.duration || 0)}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Indicador de Alta Demanda */}
                      <div className="flex items-center text-primary-600 text-sm">
                        <TrendingUp className="w-4 h-4 mr-1" />
                        <span>Oferta de valor alto</span>
                      </div>
                    </div>

                    {/* Botões de Aceitar/Recusar */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRejectRide(ride)}
                        className="w-1/2 bg-red-50 text-red-600 py-3 font-medium hover:bg-red-100 transition-colors"
                      >
                        Recusar
                      </button>
                      <button
                        onClick={() => handleAcceptRide(ride)}
                        className="w-1/2 bg-primary-600 text-white py-3 font-medium hover:bg-primary-700 transition-colors"
                      >
                        Aceitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Adicionar o mapa em tela cheia */}
      {renderFullScreenMap()}
    </div>
  );
};

export default DriverHome; 
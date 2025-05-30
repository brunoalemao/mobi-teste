import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../../utils/firebase';
import { toast } from 'react-hot-toast';
import { Car, Cloud, Clock, X } from 'lucide-react';

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
}

const Categories = () => {
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<VehicleCategory | null>(null);
  const [newCategory, setNewCategory] = useState<Partial<VehicleCategory>>({
    name: '',
    description: '',
    basePrice: 0,
    pricePerKm: 0,
    minPrice: 0,
    icon: '🚗',
    dynamicPricing: {
      rainMultiplier: 1.2,
      peakHoursMultiplier: 1.5,
      peakHours: [
        { start: "07:00", end: "09:00" },
        { start: "17:00", end: "19:00" }
      ]
    }
  });

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      setLoading(true);
      const categoriesRef = collection(db, 'vehicleCategories');
      const categoriesSnapshot = await getDocs(categoriesRef);
      const loadedCategories = categoriesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as VehicleCategory[];
      setCategories(loadedCategories);
    } catch (error) {
      console.error('Erro ao carregar categorias:', error);
      toast.error('Erro ao carregar categorias');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCategory = async () => {
    try {
      if (!newCategory.name || !newCategory.description) {
        toast.error('Preencha todos os campos obrigatórios');
        return;
      }

      const categoryData = {
        name: newCategory.name.trim(),
        description: newCategory.description.trim(),
        basePrice: Number(newCategory.basePrice) || 0,
        pricePerKm: Number(newCategory.pricePerKm) || 0,
        minPrice: Number(newCategory.minPrice) || 0,
        icon: newCategory.icon || '🚗',
        dynamicPricing: {
          rainMultiplier: Number(newCategory.dynamicPricing?.rainMultiplier) || 1.2,
          peakHoursMultiplier: Number(newCategory.dynamicPricing?.peakHoursMultiplier) || 1.5,
          peakHours: newCategory.dynamicPricing?.peakHours || [
            { start: "07:00", end: "09:00" },
            { start: "17:00", end: "19:00" }
          ]
        }
      };

      if (editingCategory) {
        await updateDoc(doc(db, 'vehicleCategories', editingCategory.id), categoryData);
        toast.success('Categoria atualizada com sucesso');
      } else {
        await addDoc(collection(db, 'vehicleCategories'), categoryData);
        toast.success('Categoria criada com sucesso');
      }

      setShowNewCategoryModal(false);
      setEditingCategory(null);
      loadCategories();
    } catch (error) {
      console.error('Erro ao salvar categoria:', error);
      toast.error('Erro ao salvar categoria');
    }
  };

  const handleEditCategory = (category: VehicleCategory) => {
    setEditingCategory(category);
    setNewCategory(category);
    setShowNewCategoryModal(true);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (window.confirm('Tem certeza que deseja excluir esta categoria?')) {
      try {
        await deleteDoc(doc(db, 'vehicleCategories', categoryId));
        toast.success('Categoria excluída com sucesso');
        loadCategories();
      } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        toast.error('Erro ao excluir categoria');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Categorias de Veículos</h1>
        <button
          onClick={() => {
            setEditingCategory(null);
            setNewCategory({
              name: '',
              description: '',
              basePrice: 0,
              pricePerKm: 0,
              minPrice: 0,
              icon: '🚗',
              dynamicPricing: {
                rainMultiplier: 1.2,
                peakHoursMultiplier: 1.5,
                peakHours: [
                  { start: "07:00", end: "09:00" },
                  { start: "17:00", end: "19:00" }
                ]
              }
            });
            setShowNewCategoryModal(true);
          }}
          className="btn-primary"
        >
          Nova Categoria
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando categorias...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4">Nome</th>
                <th className="text-left py-3 px-4">Descrição</th>
                <th className="text-left py-3 px-4">Preço Base</th>
                <th className="text-left py-3 px-4">Preço/km</th>
                <th className="text-left py-3 px-4">Preço Mínimo</th>
                <th className="text-left py-3 px-4">Multiplicadores</th>
                <th className="text-right py-3 px-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(category => (
                <tr key={category.id} className="border-b">
                  <td className="py-3 px-4">
                    <div className="flex items-center">
                      <span className="mr-2">{category.icon}</span>
                      {category.name}
                    </div>
                  </td>
                  <td className="py-3 px-4">{category.description}</td>
                  <td className="py-3 px-4">R$ {category.basePrice.toFixed(2)}</td>
                  <td className="py-3 px-4">R$ {category.pricePerKm.toFixed(2)}/km</td>
                  <td className="py-3 px-4">R$ {category.minPrice.toFixed(2)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center" title="Multiplicador de chuva">
                        <Cloud size={16} className="mr-1 text-blue-500" />
                        {category.dynamicPricing.rainMultiplier}x
                      </div>
                      <div className="flex items-center" title="Multiplicador de horário de pico">
                        <Clock size={16} className="mr-1 text-orange-500" />
                        {category.dynamicPricing.peakHoursMultiplier}x
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleEditCategory(category)}
                      className="btn-secondary text-sm mr-2"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(category.id)}
                      className="btn-error text-sm"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Nova/Editar Categoria */}
      {showNewCategoryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold">
                {editingCategory ? 'Editar Categoria' : 'Nova Categoria'}
              </h3>
              <button
                onClick={() => {
                  setShowNewCategoryModal(false);
                  setEditingCategory(null);
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome
                </label>
                <input
                  type="text"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory(prev => ({ ...prev, name: e.target.value }))}
                  className="input w-full"
                  placeholder="Ex: Econômico"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  value={newCategory.description}
                  onChange={(e) => setNewCategory(prev => ({ ...prev, description: e.target.value }))}
                  className="input w-full"
                  placeholder="Ex: Carros compactos para até 4 pessoas"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preço Base
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2">R$</span>
                    <input
                      type="number"
                      value={newCategory.basePrice}
                      onChange={(e) => setNewCategory(prev => ({ ...prev, basePrice: parseFloat(e.target.value) }))}
                      className="input w-full pl-8"
                      placeholder="5.00"
                      step="0.50"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preço por KM
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2">R$</span>
                    <input
                      type="number"
                      value={newCategory.pricePerKm}
                      onChange={(e) => setNewCategory(prev => ({ ...prev, pricePerKm: parseFloat(e.target.value) }))}
                      className="input w-full pl-8"
                      placeholder="1.50"
                      step="0.10"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Preço Mínimo
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2">R$</span>
                    <input
                      type="number"
                      value={newCategory.minPrice}
                      onChange={(e) => setNewCategory(prev => ({ ...prev, minPrice: parseFloat(e.target.value) }))}
                      className="input w-full pl-8"
                      placeholder="7.00"
                      step="0.50"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium text-gray-900">Preços Dinâmicos</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Multiplicador de Chuva
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={newCategory.dynamicPricing?.rainMultiplier}
                        onChange={(e) => setNewCategory(prev => ({
                          ...prev,
                          dynamicPricing: {
                            ...prev.dynamicPricing!,
                            rainMultiplier: parseFloat(e.target.value)
                          }
                        }))}
                        className="input w-full"
                        placeholder="1.2"
                        step="0.1"
                        min="1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Multiplicador de Horário de Pico
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={newCategory.dynamicPricing?.peakHoursMultiplier}
                        onChange={(e) => setNewCategory(prev => ({
                          ...prev,
                          dynamicPricing: {
                            ...prev.dynamicPricing!,
                            peakHoursMultiplier: parseFloat(e.target.value)
                          }
                        }))}
                        className="input w-full"
                        placeholder="1.5"
                        step="0.1"
                        min="1"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  onClick={() => {
                    setShowNewCategoryModal(false);
                    setEditingCategory(null);
                  }}
                  className="btn-secondary"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveCategory}
                  className="btn-primary"
                >
                  {editingCategory ? 'Atualizar' : 'Criar'} Categoria
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Categories; 
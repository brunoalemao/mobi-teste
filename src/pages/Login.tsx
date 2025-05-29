import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../utils/firebase';

// Form validation schema
const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  isDriver: z.boolean().optional()
});

type LoginFormData = z.infer<typeof loginSchema>;

const Login = () => {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(
    location.state?.message || null
  );

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      isDriver: false
    }
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      setIsSubmitting(true);
      setError(null);
      
      await signIn(data.email, data.password, data.isDriver);

      if (data.isDriver) {
        // Se for motorista, verificar status no Firestore
        const userDoc = await getDoc(doc(db, 'drivers', auth.currentUser?.uid || ''));
        if (userDoc.exists()) {
          const driverData = userDoc.data();
          if (driverData.status === 'approved') {
            navigate('/driver/home', { replace: true });
          } else {
            navigate('/driver/pending', { replace: true });
          }
        } else {
          navigate('/driver/pending', { replace: true });
        }
      } else {
        // Se for passageiro, ir para home
        navigate('/', { replace: true });
      }
      
      toast.success('Login realizado com sucesso!');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Ocorreu um erro ao fazer login';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto animate-slide-up">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 font-heading mb-2">Bem-vindo de volta!</h1>
        <p className="text-gray-600">Faça login para continuar</p>
      </div>

      {successMessage && (
        <div className="mb-6 p-4 bg-success-50 border border-success-200 text-success-700 rounded-lg animate-fade-in flex items-center">
          <CheckCircle size={20} className="mr-2 flex-shrink-0" />
          {successMessage}
        </div>
      )}
      
      {error && (
        <div className="mb-6 p-4 bg-error-50 border border-error-200 text-error-700 rounded-lg animate-fade-in flex items-center">
          <AlertCircle size={20} className="mr-2 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Mail size={18} className="text-gray-400" />
              </div>
              <input
                id="email"
                type="email"
                className={`input pl-10 ${errors.email ? 'border-error-500 focus:ring-error-500' : ''}`}
                placeholder="seu@email.com"
                {...register('email')}
              />
            </div>
            {errors.email && (
              <p className="text-error-600 text-sm">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Senha
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock size={18} className="text-gray-400" />
              </div>
              <input
                id="password"
                type="password"
                className={`input pl-10 ${errors.password ? 'border-error-500 focus:ring-error-500' : ''}`}
                placeholder="••••••"
                {...register('password')}
              />
            </div>
            {errors.password && (
              <p className="text-error-600 text-sm">{errors.password.message}</p>
            )}
          </div>

          <div className="flex items-center">
            <input
              id="isDriver"
              type="checkbox"
              className="h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              {...register('isDriver')}
            />
            <label htmlFor="isDriver" className="ml-2 block text-sm text-gray-700">
              Entrar como motorista
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary w-full flex justify-center py-3 text-lg"
        >
          {isSubmitting ? (
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
          ) : (
            'Entrar'
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-600">
          Não tem uma conta?{' '}
          <Link to="/cadastro" className="font-medium text-primary-600 hover:text-primary-500">
            Cadastre-se
          </Link>
          {' '}ou{' '}
          <Link to="/cadastro-motorista" className="font-medium text-primary-600 hover:text-primary-500">
            seja um motorista
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;